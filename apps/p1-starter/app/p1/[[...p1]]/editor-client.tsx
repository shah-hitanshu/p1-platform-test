"use client";

import type { Config, Data } from "@puckeditor/core";
import {
  EditorClient,
  type RemoteDatasourceContext,
  type RemoteDatasourceDefinition,
  type RouteRow,
} from "@pantheon-systems/p1-client-sdk";
import config from "../../../puck.config";

export function EditorClientWrapper(props: {
  path: string;
  data: Partial<Data>;
  remoteDatasourceContext: RemoteDatasourceContext;
  routes: RouteRow[];
  routeTemplateKeys: string[];
  savedPreviewParams: Record<string, string>;
  remoteDatasourceRegistry: RemoteDatasourceDefinition[];
}) {
  return <EditorClient {...props} config={config as Config} />;
}
