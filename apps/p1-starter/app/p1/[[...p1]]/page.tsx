import "@puckeditor/core/puck.css";
import { createP1Pages } from "@pantheon-systems/p1-client-sdk/server";
import config from "../../../puck.config";
import { REMOTE_DATASOURCE_REGISTRY } from "../../../lib/remote-datasources";
import { REMOTE_DATASOURCE_FETCHERS } from "../../../lib/remote-datasource-fetchers";
import { EditorClientWrapper } from "./editor-client";
import { RenderClientWrapper } from "./render-client";

const pages = createP1Pages({
  config,
  builtinRemoteDatasources: REMOTE_DATASOURCE_REGISTRY,
  builtinFetchers: REMOTE_DATASOURCE_FETCHERS,
  EditorClient: EditorClientWrapper,
  RenderClient: RenderClientWrapper,
});

export default pages.Page;
export const generateMetadata = pages.generateMetadata;
export const dynamic = "force-dynamic";
