/**
 * The app's published-page routes, built once and shared by both route files.
 *
 * One instance on purpose: the factory memoizes per-request work (the CCR query
 * fetchers), and "/" and the catch-all should share that rather than each
 * building their own.
 */

import { createPublishedPage } from "@pantheon-systems/p1-next-sdk/server";
import { REMOTE_DATASOURCE_FETCHERS } from "../lib/remote-datasource-fetchers";
import { ContentUnavailable } from "../components/content-unavailable";
import { Client } from "./[...puckPath]/client";
import { WelcomeBlock } from "./welcome-block";

export const published = createPublishedPage({
  Client,
  Unavailable: ContentUnavailable,
  Fallback: WelcomeBlock,
  fetchers: REMOTE_DATASOURCE_FETCHERS,
  titles: { home: "P1 Starter Kit" },
});
