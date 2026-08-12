"use client";

import type { Config, Data } from "@puckeditor/core";
import { Render } from "@puckeditor/core";
import { PuckConfigProvider } from "../../core/PuckConfigContext";

export function RenderClient({ config, data }: { config: Config; data: Data }) {
  return (
    <PuckConfigProvider config={config}>
      <Render config={config} data={data} />
    </PuckConfigProvider>
  );
}
