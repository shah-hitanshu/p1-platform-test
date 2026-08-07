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
  headers["Content-Type"] = "application/json";
  fetchInit.body = JSON.stringify({
    redirectUrl: effectiveRedirectUrl,
    // Also sent as a to-be-validated proposal (PCC-3531): CCS checks this
    // against the site's registered origins -- live on staging, not yet on
    // production. Where it's not enforced, an absent/unvalidated proposal is
    // a no-op: the backend falls back to `redirectUrl` above, same value.
    proposedRedirectUrl: effectiveRedirectUrl,
    ...(prompt !== undefined ? { prompt } : {}),
  });

  const response = await fetch(`${baseUrl}/broker/login`, fetchInit);

  const body = await response.json().catch(() => ({ error: "Unknown error" }));

  if (!response.ok) {
    return NextResponse.json(body, { status: response.status });
  }

  return NextResponse.json(body);
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
