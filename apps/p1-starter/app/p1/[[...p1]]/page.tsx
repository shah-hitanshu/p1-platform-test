import "@puckeditor/core/puck.css";
import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";
import config from "../../../puck.config";
import { EditorClientWrapper } from "./editor-client";
import { RenderClientWrapper } from "./render-client";

const pages = createP1Pages({
  config,
  cssBaseUrl: process.env.P1_CSS_BASE_URL,
  cssApiKey: process.env.P1_CSS_API_KEY,
  cssSiteId: process.env.P1_CSS_SITE_ID,
  cssBranchId: process.env.P1_CSS_BRANCH_ID,
  EditorClient: EditorClientWrapper,
  RenderClient: RenderClientWrapper,
});

export default pages.Page;
export const generateMetadata = pages.generateMetadata;
export const dynamic = "force-dynamic";
