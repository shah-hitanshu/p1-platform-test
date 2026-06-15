// Server-safe entry point — no React, no createContext, safe for RSC.
// Next.js resolves this via the "react-server" exports condition.
export { buildImageUrl } from "./utils";
export type { ImageTransformParams } from "./utils";
