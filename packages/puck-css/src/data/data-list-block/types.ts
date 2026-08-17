import type { ComponentType, ReactElement } from "react";

export interface ResolvedItem {
  title: string;
  subtitle: string;
  teaser: string;
  image: string;
  icon: string;
  _raw: Record<string, unknown>;
}

export type ImageLoading = "lazy" | "eager";

export interface LayoutProps {
  items: ResolvedItem[];
  showTitle: boolean;
  showSubtitle: boolean;
  showTeaser: boolean;
  showImage: boolean;
  showIcon: boolean;
  imageLoading?: ImageLoading;
}

export interface ImagePositionOption {
  label: string;
  value: string;
}

export interface PuckFieldDef {
  type: string;
  label: string;
  [key: string]: unknown;
}

export interface ViewModeDefinition {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
  imagePositions: ImagePositionOption[];
  fields?: Record<string, PuckFieldDef>;
  defaultProps?: Record<string, unknown>;
}

export interface DataListBlockConfig {
  label: string;
  fields: Record<string, unknown>;
  defaultProps: Record<string, unknown>;
  resolveData: (
    data: { props: Record<string, unknown> },
    context: { changed: Record<string, boolean> },
  ) => Promise<{ props: Record<string, unknown> }>;
  render: (props: Record<string, unknown>) => ReactElement | null;
  _fieldGroups?: Record<string, string>;
}

export interface CreateDataListBlockOptions {
  modes?: Record<string, ViewModeDefinition>;
  label?: string;
  wrapperClassName?: string;
}
