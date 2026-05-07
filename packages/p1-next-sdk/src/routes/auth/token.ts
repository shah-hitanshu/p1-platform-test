import { getAuth0Config } from "./config";

export async function postAuthToken(request: Request) {
  const body = await request.json();
  let auth0Config;
  try {
    auth0Config = await getAuth0Config();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
  const tokenParams = new URLSearchParams();
  tokenParams.set("client_id", auth0Config.clientId);
  if (body.device_code) {
    tokenParams.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
    tokenParams.set("device_code", body.device_code);
  } else if (body.refresh_token) {
    tokenParams.set("grant_type", "refresh_token");
    tokenParams.set("refresh_token", body.refresh_token);
  } else {
    return Response.json({ error: "Missing device_code or refresh_token" }, { status: 400 });
  }
  const tokenResp = await fetch(`${auth0Config.issuerBaseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams.toString(),
  });
  const data = await tokenResp.json();
  return Response.json(data, { status: tokenResp.status });
}
