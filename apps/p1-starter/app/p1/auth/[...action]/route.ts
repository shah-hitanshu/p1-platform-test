import { createP1AuthHandler } from "@pantheon-systems/p1-next-sdk/server";

const handler = createP1AuthHandler({
  p1ApiKey: process.env.CSS_API_KEY,
  p1BaseUrl: process.env.NEXT_PUBLIC_CSS_BASE_URL,
  prompt: 'login',
});

export const { POST } = handler;
