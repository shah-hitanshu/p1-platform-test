const DEFAULT_AUTH0_CONFIG_URL = "https://api.content.pantheon.io/auth0/config";

let _cached: { config: Record<string, string>; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getAuth0Config(): Promise<Record<string, string>> {
  const now = Date.now();
  if (_cached && now - _cached.ts < CACHE_TTL_MS) {
    return _cached.config;
  }

  const configUrl = process.env.P1_AUTH0_CONFIG_URL || DEFAULT_AUTH0_CONFIG_URL;
  const configResp = await fetch(configUrl);
  if (!configResp.ok) {
    throw new Error(`Failed to fetch Auth0 config from ${configUrl} (${configResp.status})`);
  }
  const config = await configResp.json();

  if (
    typeof config.issuerBaseUrl !== "string" ||
    !config.issuerBaseUrl.startsWith("https://")
  ) {
    throw new Error("Auth0 config: issuerBaseUrl must be an https:// URL");
  }

  const audienceOverride = process.env.P1_AUTH0_AUDIENCE;
  if (audienceOverride) {
    config.audience = audienceOverride;
  }

  _cached = { config, ts: now };
  return config;
}
