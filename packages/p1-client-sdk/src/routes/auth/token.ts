const AUTH0_CONFIG_URL = "https://api.content.pantheon.io/auth0/config";

export async function POST(request: Request) {
  const body = await request.json();
  const configResp = await fetch(AUTH0_CONFIG_URL);
  if (!configResp.ok) {
    return Response.json(
      { error: "Failed to fetch Auth0 config" },
      { status: 502 }
    );
  }
  const auth0Config = await configResp.json();

  const params = new URLSearchParams();
  params.set("client_id", auth0Config.clientId);

  if (body.device_code) {
    params.set(
      "grant_type",
      "urn:ietf:params:oauth:grant-type:device_code"
    );
    params.set("device_code", body.device_code);
  } else if (body.refresh_token) {
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", body.refresh_token);
  } else {
    return Response.json({ error: "Missing device_code or refresh_token" }, { status: 400 });
  }

  const tokenResp = await fetch(`${auth0Config.issuerBaseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await tokenResp.json();
  return Response.json(data, { status: tokenResp.status });
}
