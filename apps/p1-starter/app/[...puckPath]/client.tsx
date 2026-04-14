"use client";

import type { Data } from "@puckeditor/core";
import { RenderClient } from "@pantheon-systems/p1-client-sdk";
import config from "../../puck.config";

export function Client({ data }: { data: Data }) {
  return <RenderClient config={config} data={data} />;
}
