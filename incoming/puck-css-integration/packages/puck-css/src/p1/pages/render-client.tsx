"use client";

import type { Config, Data } from "@puckeditor/core";
import { Render } from "@puckeditor/core";

export function RenderClient({ config, data }: { config: Config; data: Data }) {
  return <Render config={config} data={data} />;
}
