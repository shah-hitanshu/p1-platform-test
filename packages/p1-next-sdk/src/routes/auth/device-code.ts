import { getAuth0Config } from "./config";

const SCOPES = "openid profile offline_access create:session";

export async function postAuthDeviceCode() {
  try {
    console.log("[p1-auth] Fetching Auth0 config");
    const auth0Config = await getAuth0Config();
    console.log("[p1-auth] Using audience:", auth0Config.audience);
    const deviceCodeUrl = `${auth0Config.issuerBaseUrl}/oauth/device/code`;
    console.log("[p1-auth] Starting device flow at:", deviceCodeUrl);
    const deviceResp = await fetch(deviceCodeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: auth0Config.clientId,
        scope: SCOPES,
        audience: auth0Config.audience,
      }),
    });
    if (!deviceResp.ok) {
      const body = await deviceResp.text().catch(() => "");
      console.error("[p1-auth] Device code request failed:", deviceResp.status, deviceCodeUrl, body);
      return Response.json({ error: `Device flow failed at ${deviceCodeUrl} (${deviceResp.status})` }, { status: 502 });
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
  } catch (err) {
    console.error("[p1-auth] Device code flow threw:", err);
    return Response.json({ error: `Auth0 device flow error: ${(err as Error).message}` }, { status: 500 });
  }
}
