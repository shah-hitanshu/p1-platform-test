/**
 * R2 presigner.
 *
 * Mints short-lived S3-compatible GET URLs for R2 objects so the browser
 * can fetch the bytes directly from R2 without proxying through the worker.
 */

import { AwsClient } from 'aws4fetch';

export interface SignR2GetUrlParams {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  key: string;
  ttlSeconds: number;
}

export interface SignedR2Url {
  url: string;
  expiresAt: string;
}

export async function signR2GetUrl(params: SignR2GetUrlParams): Promise<SignedR2Url> {
  const client = new AwsClient({
    service: 's3',
    region: 'auto',
    accessKeyId: params.accessKeyId,
    secretAccessKey: params.secretAccessKey,
  });

  const endpoint = `https://${params.accountId}.r2.cloudflarestorage.com`;
  const requestUrl = `${endpoint}/${params.bucket}/${params.key}?X-Amz-Expires=${String(params.ttlSeconds)}`;

  const signed = await client.sign(new Request(requestUrl), {
    aws: { signQuery: true },
  });

  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000).toISOString();
  return { url: signed.url, expiresAt };
}
