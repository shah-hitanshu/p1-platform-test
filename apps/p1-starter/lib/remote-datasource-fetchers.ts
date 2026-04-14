import type { RemoteDatasourceFetcher } from "@pantheon-systems/p1-client-sdk";
import { SWAPI_FETCHERS } from "./swapi";
import { MONSTER_FETCHERS } from "./monsters-api";
import { CONTENT_PUBLISHER_FETCHERS } from "./content-publisher";

export const REMOTE_DATASOURCE_FETCHERS: RemoteDatasourceFetcher[] = [
  ...SWAPI_FETCHERS,
  ...MONSTER_FETCHERS,
  ...CONTENT_PUBLISHER_FETCHERS,
];
