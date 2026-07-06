import { NextResponse } from "next/server";

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

  if (!siteUrl && process.env.NODE_ENV === 'production') {
    console.warn(
      "[P1AuthHandler] p1SiteUrl is not set. Redirect URLs may be incorrect behind a reverse proxy. " +
      "Set p1SiteUrl in your P1AuthHandlerConfig (e.g. process.env.P1_SITE_URL). " +
      "This will be required in a future major version.",
    );
  }

  const actualOrigin = siteUrl
    ? new URL(siteUrl).origin
    : requestUrl.origin;

  const effectiveRedirectUrl = redirectUrl ?? actualOrigin + basePath;
  headers["Content-Type"] = "application/json";
  fetchInit.body = JSON.stringify({
    redirectUrl: effectiveRedirectUrl,
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
