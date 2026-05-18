import { NextResponse } from "next/server";

export async function postBrokerLogin(
  _request: Request,
  apiKey: string | undefined,
  baseUrl: string | undefined,
) {
  if (!apiKey || !baseUrl) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  const response = await fetch(`${baseUrl}/broker/login`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
  });

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
