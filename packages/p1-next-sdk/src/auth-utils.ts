export function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) return undefined;
  return header.match(/^Bearer\s+(.+)$/i)?.[1];
}
