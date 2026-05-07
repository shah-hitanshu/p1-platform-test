"use client";

import type { Data } from "@puckeditor/core";
import { RenderClient } from "@pantheon-systems/puck-css";
import config from "../../../puck.config";

export function RenderClientWrapper({ data }: { data: Data }) {
  return <RenderClient config={config} data={data} />;
}
