import "@puckeditor/core/puck.css";
import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";
import config from "../../../puck.config";
import { EditorClientWrapper } from "./editor-client";
import { RenderClientWrapper } from "./render-client";

const pages = createP1Pages({
  config,
  p1BaseUrl: process.env.P1_CSS_BASE_URL,
  p1ApiKey: process.env.P1_CSS_API_KEY,
  p1SiteId: process.env.P1_CSS_SITE_ID,
  p1BranchId: process.env.P1_CSS_BRANCH_ID,
  EditorClient: EditorClientWrapper,
  RenderClient: RenderClientWrapper,
});

export default pages.Page;
export const generateMetadata = pages.generateMetadata;
export const dynamic = "force-dynamic";
