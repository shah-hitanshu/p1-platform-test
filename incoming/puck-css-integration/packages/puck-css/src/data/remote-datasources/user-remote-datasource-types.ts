export type RemoteDatasourceFieldDocInput = {
  path: string;
  description: string;
};

export type HttpJsonRemoteDatasourceDefinition = {
  id: string;
  label: string;
  description: string;
  urlTemplate: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  fields: RemoteDatasourceFieldDocInput[];
};

export type RemoteDatasourceScope = "global" | "page";
