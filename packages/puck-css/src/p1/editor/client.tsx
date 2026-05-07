"use client";

import type { Config, Data } from "@puckeditor/core";
import { Puck } from "@puckeditor/core";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import type { RemoteDatasourceDefinition } from "../../data/remote-datasources/remote-datasource-registry";
import type { RemoteDatasourceContext } from "../../data/remote-datasources/loader";
import type { RouteRow } from "../../data/page-store";
import { createRemoteDatasourceExplorerPlugin } from "./remote-datasources/remote-datasource-explorer-plugin";
import { createFieldConnectPlugin } from "./connect/field-connect-plugin";
import {
  createPreviewResolvePlugin,
  wrapConfigForEditorPreview,
} from "./editor-preview-resolve";
import { Toaster, ToastType, useToast } from "@pantheon-systems/pds-toolkit-react";
import { P1QueryProvider } from "../../data/query-provider";
import { usePublish } from "./hooks";
import { ButtonBlockIcon } from "./icons/button-block-icon";
import { DefaultBlockIcon } from "./icons/default-block-icon";
import { DividerBlockIcon } from "./icons/divider-block-icon";
import { GridBlockIcon } from "./icons/grid-block-icon";
import { HeadingBlockIcon } from "./icons/heading-block-icon";
import { ImageBlockIcon } from "./icons/image-block-icon";
import { ListBlockIcon } from "./icons/list-block-icon";
import { ParagraphBlockIcon } from "./icons/paragraph-block-icon";
import { QuoteBlockIcon } from "./icons/quote-block-icon";
import { SpacerBlockIcon } from "./icons/spacer-block-icon";

const iconStyle = {
  width: 16,
  height: 16,
  color: "#737373",
  flexShrink: 0,
} as const;

const blockIcons: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
  HeadingBlock: HeadingBlockIcon,
  ParagraphBlock: ParagraphBlockIcon,
  QuoteBlock: QuoteBlockIcon,
  ListBlock: ListBlockIcon,
  ImageBlock: ImageBlockIcon,
  GridBlock: GridBlockIcon,
  DividerBlock: DividerBlockIcon,
  SpacerBlock: SpacerBlockIcon,
  ButtonBlock: ButtonBlockIcon,
};

function ComponentListIcon({ name }: { name: string }) {
  const Icon = blockIcons[name] ?? DefaultBlockIcon;
  return <Icon style={iconStyle} />;
}

function ComponentListItem({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full items-center gap-2 [&>*:last-child]:w-full [&>*:last-child]:flex-1">
      <ComponentListIcon name={name} />
      {children}
    </div>
  );
}

type ClientProps = {
  path: string;
  data: Partial<Data>;
  config: Config;
  remoteDatasourceContext: RemoteDatasourceContext;
  routes: RouteRow[];
  routeTemplateKeys: string[];
  savedPreviewParams: Record<string, string>;
  remoteDatasourceRegistry: RemoteDatasourceDefinition[];
};

function ClientInner(props: ClientProps) {
  const {
    path, data, config, remoteDatasourceContext,
    routes, routeTemplateKeys, savedPreviewParams, remoteDatasourceRegistry,
  } = props;

  const editorConfig = useMemo(
    () => wrapConfigForEditorPreview(config),
    [config],
  );

  const [addToast] = useToast();
  const publish = usePublish(path);

  const overrides = useMemo(
    () => ({
      drawerItem: ({ name, children }: { name: string; children: ReactNode }) => (
        <ComponentListItem name={name}>{children}</ComponentListItem>
      ),
    }),
    [],
  );

  const plugins = useMemo(
    () => [
      createPreviewResolvePlugin(remoteDatasourceContext),
      createRemoteDatasourceExplorerPlugin(remoteDatasourceContext, {
        editorPath: path,
        routeTemplateKeys,
        savedPreviewParams,
        remoteDatasourceRegistry,
      }),
      createFieldConnectPlugin({
        routes,
        config,
        editorPath: path,
        remoteDatasourceRegistry,
      }),
    ],
    [remoteDatasourceContext, path, routeTemplateKeys, savedPreviewParams, remoteDatasourceRegistry, routes, config],
  );

  const onPublish = useCallback(
    (data: Data) => {
      publish.mutate(data, {
        onSuccess: () => addToast(ToastType.Success, "Page published successfully"),
        onError: () => addToast(ToastType.Critical, "Failed to publish page"),
      });
    },
    [publish, addToast],
  );

  return (
    <>
      <Toaster />
      <Puck
        config={editorConfig}
        data={data}
        overrides={overrides}
        plugins={plugins}
        onPublish={onPublish}
      />
    </>
  );
}

export function Client(props: ClientProps) {
  return (
    <P1QueryProvider>
      <ClientInner {...props} />
    </P1QueryProvider>
  );
}
