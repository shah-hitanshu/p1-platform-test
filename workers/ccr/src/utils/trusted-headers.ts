/**
 * X-Verified-* headers carry the identity this Worker resolved from the
 * authenticated credential (actor id, type, email, ...). Durable Objects treat
 * them as trusted because a DO is reachable only through this Worker. A client
 * must therefore never supply them.
 */
const TRUSTED_HEADER_PREFIX = 'x-verified-';

/**
 * Remove any inbound X-Verified-* headers so a caller cannot forge the identity
 * the Worker injects downstream. Returns the request unchanged when none are
 * present, so legitimate traffic (including WebSocket upgrades) is never cloned.
 */
export function stripInboundTrustedHeaders(request: Request): Request {
  let present = false;
  for (const name of request.headers.keys()) {
    if (name.startsWith(TRUSTED_HEADER_PREFIX)) {
      present = true;
      break;
    }
  }
  if (!present) {
    return request;
  }

  const scrubbed = new Request(request);
  for (const name of [...scrubbed.headers.keys()]) {
    if (name.startsWith(TRUSTED_HEADER_PREFIX)) {
      scrubbed.headers.delete(name);
    }
  }
  return scrubbed;
}
