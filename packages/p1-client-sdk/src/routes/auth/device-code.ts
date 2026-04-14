const AUTH0_CONFIG_URL = "https://api.content.pantheon.io/auth0/config";
const SCOPES = "openid profile offline_access create:session";

export async function POST() {
  const configResp = await fetch(AUTH0_CONFIG_URL);
  if (!configResp.ok) {
    return Response.json(
      { error: "Failed to fetch Auth0 config" },
      { status: 502 }
    );
  }
  const auth0Config = await configResp.json();

  const deviceResp = await fetch(
    `${auth0Config.issuerBaseUrl}/oauth/device/code`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: auth0Config.clientId,
        scope: SCOPES,
        audience: auth0Config.audience,
      }),
    }
  );

  if (!deviceResp.ok) {
    return Response.json(
      { error: "Failed to initiate device flow" },
      { status: 502 }
    );
  }

  const data = await deviceResp.json();
  return Response.json({
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    verification_uri_complete: data.verification_uri_complete,
    interval: data.interval,
    expires_in: data.expires_in,
  });
}
