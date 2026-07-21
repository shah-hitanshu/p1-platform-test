/**
 * Broker JWT Issuer
 *
 * Issues HS256-signed JWTs via GCP Cloud KMS MAC. The symmetric key never
 * leaves GCP — we send the raw signing input to KMS for MAC computation.
 * The primary key version is resolved automatically, supporting seamless
 * key rotation.
 */

import { base64url } from 'jose';
import { macSign, getPrimaryKeyVersion, deriveKid } from './gcp-kms-client.js';

export interface BrokerJwtParams {
  serviceAccountKeyJson: string;
  keyResource: string;
  issuer: string;
  subject: string;
  audience: string;
  ttlSeconds: number;
  siteId: string;
  email: string;
  name?: string;
  provider: string;
}

export async function issueBrokerJwt(params: BrokerJwtParams): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  const keyVersion = await getPrimaryKeyVersion(
    params.serviceAccountKeyJson,
    params.keyResource,
  );

  const header = {
    alg: 'HS256',
    typ: 'JWT',
    kid: deriveKid(keyVersion),
  };

  const payload: Record<string, unknown> = {
    iss: params.issuer,
    sub: params.subject,
    aud: params.audience,
    iat: now,
    exp: now + params.ttlSeconds,
    jti: crypto.randomUUID(),
    site_id: params.siteId,
    email: params.email,
    provider: params.provider,
  };

  if (params.name !== undefined) {
    payload.name = params.name;
  }

  const headerB64 = base64url.encode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64url.encode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const { mac } = await macSign(
    params.serviceAccountKeyJson,
    params.keyResource,
    encoder.encode(signingInput),
  );

  const signatureB64 = base64url.encode(mac);

  return `${signingInput}.${signatureB64}`;
}
