import { createP1Middleware } from "@pantheon-systems/p1-next-sdk/server";

const p1Middleware = createP1Middleware({
  cssBaseUrl: process.env.NEXT_PUBLIC_CSS_BASE_URL ?? "http://localhost:8787",
  apiToken: process.env.CSS_API_KEY ?? "",
  siteId: process.env.NEXT_PUBLIC_CSS_SITE_ID ?? "",
});

export async function middleware(request: Request) {
  return p1Middleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
