import { describe, expect, it } from 'vitest';

describe('puck-css client exports', () => {
  it('exports lib utilities', async () => {
    const mod = await import('../../data/paths');
    expect(mod.normalizePath).toBeDefined();
    expect(mod.stripTrailingSlash).toBeDefined();
  });

  it('exports route-templates', async () => {
    const mod = await import('../../data/route-templates');
    expect(mod.isCanonicalTemplatePath).toBeDefined();
    expect(mod.templatePathParamNames).toBeDefined();
  });

  it('exports cross-reference', async () => {
    const mod = await import('../../data/cross-reference');
    expect(mod.encodePagesBlocksTemplate).toBeDefined();
    expect(mod.isCrossPageRefTemplateString).toBeDefined();
  });

  it('exports remote-datasource-registry', async () => {
    const mod = await import('../../data/remote-datasources/remote-datasource-registry');
    expect(mod.buildRemoteDatasourceRegistry).toBeDefined();
  });

  it('exports router context', async () => {
    const mod = await import('../../p1/router-context');
    expect(mod.P1RouterContext).toBeDefined();
    expect(mod.useP1Router).toBeDefined();
  });

  it('exports query provider', async () => {
    const mod = await import('../../data/query-provider');
    expect(mod.P1QueryProvider).toBeDefined();
  });

  it('exports connectable', async () => {
    const mod = await import('../../editor/components/connectable');
    expect(mod.Connectable).toBeDefined();
    expect(mod.renderItemTemplate).toBeDefined();
  });

  it('exports editor components', async () => {
    const mod = await import('../../p1/editor/index');
    expect(mod.EditorClient).toBeDefined();
    expect(mod.createRemoteDatasourceExplorerPlugin).toBeDefined();
    expect(mod.createFieldConnectPlugin).toBeDefined();
    expect(mod.wrapConfigForEditorPreview).toBeDefined();
  });

  it('exports pages components', async () => {
    const mod = await import('../../p1/pages/index');
    expect(mod.RenderClient).toBeDefined();
    expect(mod.CreatePageForm).toBeDefined();
    expect(mod.CreateTemplateForm).toBeDefined();
    expect(mod.AddOverrideForTemplate).toBeDefined();
    expect(mod.DeleteStructureRowButton).toBeDefined();
    expect(mod.useCreateStructure).toBeDefined();
    expect(mod.useDeleteStructurePage).toBeDefined();
  });
});

describe('puck-css server exports', () => {
  it('exports DAL functions', async () => {
    const mod = await import('../../data/dal/index');
    expect(mod.getPageStore).toBeDefined();
    expect(mod.initializeStores).toBeDefined();
  });

  it('exports p1-store', async () => {
    const mod = await import('../../data/dal/p1-store');
    expect(mod.createP1PageStore).toBeDefined();
  });

  it('exports page-store functions', async () => {
    const mod = await import('../../data/page-store');
    expect(mod.listRoutes).toBeDefined();
    expect(mod.createStaticPage).toBeDefined();
    expect(mod.resolvePageData).toBeDefined();
  });

  it('exports get-page', async () => {
    const mod = await import('../../data/get-page');
    expect(mod.getPage).toBeDefined();
  });

  it('exports remote-datasource loader', async () => {
    const mod = await import('../../data/remote-datasources/loader');
    expect(mod.loadRemoteDatasourceContext).toBeDefined();
  });

  it('exports cross-reference-resolve', async () => {
    const mod = await import('../../data/cross-reference-resolve');
    expect(mod.resolveCrossPageTemplates).toBeDefined();
  });

  it('exports resolve-data-templates', async () => {
    const mod = await import('../../data/resolve-data-templates');
    expect(mod.resolveStringTemplates).toBeDefined();
    expect(mod.resolveDataTemplates).toBeDefined();
  });
});
