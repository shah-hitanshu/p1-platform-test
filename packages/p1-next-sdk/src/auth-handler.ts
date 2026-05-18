import { NextResponse } from "next/server";
import { postBrokerLogin, postBrokerRedeem } from "./routes/broker";

export interface P1AuthHandlerConfig {
  p1ApiKey?: string;
  p1BaseUrl?: string;
}

export function createP1AuthHandler(opts: P1AuthHandlerConfig) {
  async function POST(
    request: Request,
    { params }: { params: Promise<{ action?: string[] }> },
  ) {
    const { action = [] } = await params;
    const route = action[0];

    if (route === "login") {
      return postBrokerLogin(request, opts.p1ApiKey, opts.p1BaseUrl);
    }
    if (route === "redeem") {
      return postBrokerRedeem(request, opts.p1ApiKey, opts.p1BaseUrl);
    }

    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return { POST };
}
