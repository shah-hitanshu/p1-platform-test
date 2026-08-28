import { NextResponse } from "next/server";

// Route Handler `request.url` reflects the Node server's own bind address
// (e.g. localhost:3000), not the Host the browser actually requested, once a
// reverse proxy is involved -- but its scheme is unaffected by that, so only
// the host needs replacing.
//
// Deliberately reads `host`, NOT `x-forwarded-host`: on Pantheon, `Host` is
// what the edge routes on, so a request only reaches this container with a
// Host that resolves to this site -- an arbitrary Host 404s upstream.
// `X-Forwarded-Host` is not similarly validated; it passes through from the
// client unchanged, so trusting it here would let anyone redirect a login
// to an attacker-controlled origin (confirmed empirically, not theoretical).
function deriveOriginFromRequest(request: Request): string {
  const host = request.headers.get("host");
  const requestUrl = new URL(request.url);
  if (host === null) {
    return requestUrl.origin;
  }
  return `${requestUrl.protocol}//${host}`;
}

export async function postBrokerLogin(
  request: Request,
  apiKey: string | undefined,
  baseUrl: string | undefined,
  siteUrl?: string,
  redirectUrl?: string,
  prompt?: string,
) {
  if (!apiKey || !baseUrl) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
  };
  const fetchInit: RequestInit = {
    method: "POST",
    headers,
  };

  const requestUrl = new URL(request.url);
  const basePath = requestUrl.pathname.replace(/\/auth\/.*$/, '') || '/';

  const siteUrlValue = siteUrl ?? process.env.P1_SITE_URL;
  const derivedOrigin = deriveOriginFromRequest(request);

  if (!siteUrlValue && derivedOrigin === requestUrl.origin && process.env.NODE_ENV === 'production') {
    console.warn(
      "[P1AuthHandler] p1SiteUrl is not set and no Host header was present. " +
      "Redirect URLs may be incorrect behind a reverse proxy. " +
      "Set the P1_SITE_URL environment variable or pass p1SiteUrl in your P1AuthHandlerConfig.",
    );
  }

  let actualOrigin = derivedOrigin;
  if (siteUrlValue) {
    try {
      actualOrigin = new URL(siteUrlValue).origin;
    } catch {
      console.warn(
        `[P1AuthHandler] P1_SITE_URL/p1SiteUrl ("${siteUrlValue}") is not a valid URL; ` +
        "falling back to the request's own origin.",
      );
    }
  }

  const effectiveRedirectUrl = redirectUrl ?? actualOrigin + basePath;

  // PCC-3531: the fallback above yields localhost on a deployed site because this
  // server cannot see its own public origin. The browser can, so pass its origin
  // upstream as a proposal for CCR to validate. Skipped when a target is
  // configured, keeping those requests byte-identical to before.
  const hasExplicitTarget = redirectUrl !== undefined || siteUrlValue !== undefined;
  const proposedOrigin = hasExplicitTarget
    ? undefined
    : await readProposedOrigin(request);

  headers["Content-Type"] = "application/json";
  fetchInit.body = JSON.stringify({
    redirectUrl: effectiveRedirectUrl,
    ...(proposedOrigin !== undefined
      ? { proposedRedirectUrl: proposedOrigin + basePath }
      : {}),
    ...(prompt !== undefined ? { prompt } : {}),
  });

  const response = await fetch(`${baseUrl}/broker/login`, fetchInit);

  const body = await response.json().catch(() => ({ error: "Unknown error" }));

  if (!response.ok) {
    return NextResponse.json(body, { status: response.status });
  }

  // Log then strip: this route is public, so echoing the warning would let anyone
  // probe whether an origin is registered for a site. The browser never reads it.
  const { warning, ...clientBody } = body as { warning?: unknown } & Record<string, unknown>;
  if (typeof warning === "string" && warning !== "") {
    console.warn(`[P1AuthHandler] ${warning}`);
  }

  return NextResponse.json(clientBody);
}

/**
 * Still untrusted after this — CCR validates against the site's registered
 * origins. Malformed values are dropped rather than forwarded upstream.
 */
async function readProposedOrigin(request: Request): Promise<string | undefined> {
  let parsed: { origin?: unknown };
  try {
    parsed = await request.clone().json() as { origin?: unknown };
  } catch {
    return undefined;
  }

  const candidate = parsed.origin;
  if (typeof candidate !== "string" || candidate === "") {
    return undefined;
  }

  try {
    // Re-deriving the origin and requiring an exact match rejects anything
    // carrying a path or credentials.
    const url = new URL(candidate);
    return url.origin === candidate ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export async function postBrokerRedeem(
  request: Request,
  apiKey: string | undefined,
  baseUrl: string | undefined,
) {
  if (!apiKey || !baseUrl) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  let parsed: { transactionId?: string };
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!parsed.transactionId) {
    return NextResponse.json(
      { error: "Missing transactionId" },
      { status: 400 },
    );
  }

  const response = await fetch(`${baseUrl}/broker/redeem`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ transactionId: parsed.transactionId }),
  });

  const body = await response.json().catch(() => ({ error: "Unknown error" }));

  if (!response.ok) {
    return NextResponse.json(body, { status: response.status });
  }

  return NextResponse.json(body);
}

/**
 * Unlike login and redeem, this carries no API key: logout authenticates with
 * the broker JWT the browser already holds. The hop exists so a proxy-mode app
 * can keep a same-origin connect-src, matching how login and redeem are routed.
 */
export async function postBrokerLogout(
  request: Request,
  baseUrl: string | undefined,
) {
  if (!baseUrl) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization");
  if (authorization === null) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const origin = request.headers.get("origin");
  const response = await fetch(`${baseUrl}/broker/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authorization,
      ...(origin !== null ? { "Origin": origin } : {}),
    },
    body: await request.text(),
  });

  const body = await response.json().catch(() => ({ error: "Unknown error" }));

  if (!response.ok) {
    return NextResponse.json(body, { status: response.status });
  }

  // CCR no longer returns a warning here, but an older backend might, and it
  // names whether an origin is registered for a site. This route is public.
  const { warning: _warning, ...clientBody } = body as { warning?: unknown } & Record<
    string,
    unknown
  >;

  return NextResponse.json(clientBody);
}
