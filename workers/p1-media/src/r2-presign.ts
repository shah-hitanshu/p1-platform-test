import { AwsClient } from 'aws4fetch';
import { Env } from './types';

// Short-lived — the client is expected to PUT immediately after minting.
const PRESIGN_EXPIRY_SECONDS = 300;

export interface PresignedUpload {
  uploadUrl: string;
  expiresAt: string; // ISO timestamp
}

/**
 * Signs a presigned PUT URL for a direct browser-to-R2 upload via R2's S3-compatible
 * API. This is a distinct credential/API surface from the MEDIA_BUCKET binding (which
 * has no presign capability) — see R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY on Env.
 *
 * Content-Type is included as a signed header, so R2 rejects any PUT whose declared
 * type doesn't match what was validated at presign time — real, signature-enforced
 * defense against a client re-declaring a different type at upload time.
 */
export async function createPresignedPutUrl(
  env: Env,
  key: string,
  contentType: string,
): Promise<PresignedUpload> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });

  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${encodedKey}`,
  );
  url.searchParams.set('X-Amz-Expires', String(PRESIGN_EXPIRY_SECONDS));

  // allHeaders: true is required for Content-Type to actually end up in
  // SignedHeaders — aws4fetch excludes it (along with content-length, user-agent,
  // etc.) from signing by default via a hardcoded UNSIGNABLE_HEADERS set. Without
  // this, the signature only covers `host`, and the Content-Type enforcement this
  // function's docstring describes silently doesn't happen. Confirmed by an actual
  // presigned URL against real R2 (staging): omitting this produced
  // `X-Amz-SignedHeaders=host` with no content-type.
  const signed = await client.sign(
    new Request(url, { method: 'PUT', headers: { 'Content-Type': contentType } }),
    { aws: { signQuery: true, allHeaders: true } },
  );

  return {
    uploadUrl: signed.url,
    expiresAt: new Date(Date.now() + PRESIGN_EXPIRY_SECONDS * 1000).toISOString(),
  };
}
