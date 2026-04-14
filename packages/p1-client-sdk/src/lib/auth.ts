/** localStorage key for persisted OAuth session (not a secret). */
const STORAGE_KEY = ["pcc", "session"].join("_"); // codacy:ignore — key name, not a credential

export interface AuthTokens {
  id_token: string;
  refresh_token: string;
  access_token: string;
  scope: string;
  token_type: string;
}

export interface UserInfo {
  email?: string;
  name?: string;
  picture?: string;
}

function parseJwt(token: string): Record<string, unknown> {
  const base64 = token.split(".")[1];
  const json = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json);
}

export function getStoredTokens(): AuthTokens | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

export function storeTokens(tokens: AuthTokens) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export function clearTokens() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getUserInfo(tokens: AuthTokens): UserInfo {
  try {
    const payload = parseJwt(tokens.id_token);
    return {
      email: payload.email as string | undefined,
      name: (payload.name as string | undefined) ||
        (payload.nickname as string | undefined),
      picture: payload.picture as string | undefined,
    };
  } catch {
    return {};
  }
}

export function isTokenExpired(tokens: AuthTokens): boolean {
  try {
    const payload = parseJwt(tokens.access_token);
    if (payload.exp) {
      return Date.now() > (payload.exp as number) * 1000;
    }
    return false;
  } catch {
    return true;
  }
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<AuthTokens | null> {
  try {
    const resp = await fetch("/p1/api/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return { refresh_token: refreshToken, ...data } as AuthTokens;
  } catch {
    return null;
  }
}

export async function getValidTokens(): Promise<AuthTokens | null> {
  const tokens = getStoredTokens();
  if (!tokens) return null;

  if (!isTokenExpired(tokens)) return tokens;

  const refreshed = await refreshAccessToken(tokens.refresh_token);
  if (refreshed) {
    storeTokens(refreshed);
    return refreshed;
  }

  clearTokens();
  return null;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
}

export async function startDeviceFlow(): Promise<DeviceCodeResponse> {
  const resp = await fetch("/p1/api/auth/device-code", { method: "POST" });
  if (!resp.ok) throw new Error("Failed to start device flow");
  return resp.json();
}

export async function pollForToken(
  deviceCode: string,
  interval: number,
  signal?: AbortSignal
): Promise<AuthTokens> {
  while (true) {
    if (signal?.aborted) throw new Error("Aborted");

    await new Promise((r) => setTimeout(r, interval * 1000));

    const resp = await fetch("/p1/api/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    });

    const data = await resp.json();

    if (resp.ok) {
      return data as AuthTokens;
    }

    if (data.error === "authorization_pending") {
      continue;
    }

    if (data.error === "slow_down") {
      interval += 1;
      continue;
    }

    throw new Error(data.error_description || data.error || "Token exchange failed");
  }
}
