import { createP1Handler } from "@pantheon-systems/p1-next-sdk/server";
import config from "../../../../puck.config";
import { REMOTE_DATASOURCE_FETCHERS } from "../../../../lib/remote-datasource-fetchers";
import { REMOTE_DATASOURCE_REGISTRY } from "../../../../lib/remote-datasources";

const handler = createP1Handler({
  config,
  p1BaseUrl: process.env.NEXT_PUBLIC_CSS_BASE_URL,
  p1ApiKey: process.env.P1_CSS_API_KEY,
  p1SiteId: process.env.NEXT_PUBLIC_CSS_SITE_ID,
  p1BranchId: process.env.NEXT_PUBLIC_CSS_BRANCH_ID,
  builtinFetchers: REMOTE_DATASOURCE_FETCHERS,
  builtinDatasourceRegistry: REMOTE_DATASOURCE_REGISTRY,
});

export const { GET, POST, DELETE } = handler;
