import "@puckeditor/core/puck.css";
import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";
import config from "../../../puck.config";
import { EditorClientWrapper } from "./editor-client";
import { RenderClientWrapper } from "./render-client";

const pages = createP1Pages({
  config,
  p1BaseUrl: process.env.NEXT_PUBLIC_CSS_BASE_URL,
  p1ApiKey: process.env.CSS_API_KEY,
  p1SiteId: process.env.NEXT_PUBLIC_CSS_SITE_ID,
  // Default to "main" when unset: server components (no user token) need a
  // branch to list/read documents (e.g. the /p1/structure routes table).
  p1BranchId: process.env.NEXT_PUBLIC_CSS_BRANCH_ID ?? "main",
  EditorClient: EditorClientWrapper,
  RenderClient: RenderClientWrapper,
});

export default pages.Page;
export const generateMetadata = pages.generateMetadata;
export const dynamic = "force-dynamic";
