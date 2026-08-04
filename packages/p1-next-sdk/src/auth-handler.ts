import { NextResponse } from "next/server";
import { PRODUCTION_BASE_URL } from "@pantheon-systems/puck-css/server";
import { postBrokerLogin, postBrokerRedeem } from "./routes/broker";

export interface P1AuthHandlerConfig {
  p1ApiKey?: string;
  p1BaseUrl?: string;
  p1SiteUrl?: string;
  redirectUrl?: string;
  prompt?: string;
}

export function createP1AuthHandler(opts: P1AuthHandlerConfig) {
  async function POST(
    request: Request,
    { params }: { params: Promise<{ action?: string[] }> },
  ) {
    const { action = [] } = await params;
    const route = action[0];
    // Same fallback as createNextConfig/createNextContentClient (PCC-3282):
    // an unset p1BaseUrl (no CSS_BASE_URL / NEXT_PUBLIC_CSS_BASE_URL) should
    // resolve to the production backend rather than failing broker login.
    const p1BaseUrl = opts.p1BaseUrl ?? PRODUCTION_BASE_URL;

    if (route === "login") {
      return postBrokerLogin(request, opts.p1ApiKey, p1BaseUrl, opts.p1SiteUrl, opts.redirectUrl, opts.prompt);
    }
    if (route === "redeem") {
      return postBrokerRedeem(request, opts.p1ApiKey, p1BaseUrl);
    }

    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return { POST };
}
