import { describe, expect, it } from 'vitest';

import {
  defaultInstancePathFromTemplate,
  editorPathHref,
  isCanonicalTemplatePath,
  pagePathFromCatchAllSegments,
  publicPagePathHref,
  isRouteTemplatePath,
  matchConcretePathToTemplateParams,
  pickTemplateSourcePath,
  resolveTemplateMatch,
  templatePathParamNames,
} from '../../data/route-templates';

const JEDI = '/jedi/:id';
const KEYS = [JEDI, '/starships/:id', '/test/:a/:b'];

describe('editorPathHref', () => {
  it('uses /p1/edit for root so it opens the editor, not the dashboard', () => {
    expect(editorPathHref('/')).toBe('/p1/edit');
    expect(editorPathHref('')).toBe('/p1/edit');
    expect(editorPathHref('   ')).toBe('/p1/edit');
    expect(editorPathHref('/ ')).toBe('/p1/edit');
  });

  it('prepends /p1 for non-root paths', () => {
    expect(editorPathHref('/contact-us')).toBe('/p1/contact-us');
    expect(editorPathHref('/jedi/:id')).toBe('/p1/jedi/:id');
  });

  it('inserts the /p1/ separator for slash-less stored paths (CCR canonical form)', () => {
    expect(editorPathHref('contact-us')).toBe('/p1/contact-us');
    expect(editorPathHref('blog/my-post')).toBe('/p1/blog/my-post');
  });
});

describe('publicPagePathHref', () => {
  it('normalizes root', () => {
    expect(publicPagePathHref('/')).toBe('/');
    expect(publicPagePathHref('')).toBe('/');
  });
});

describe('pagePathFromCatchAllSegments', () => {
  it('decodes : in template segments (e.g. %3Aid → :id)', () => {
    expect(pagePathFromCatchAllSegments(['jedi', '%3Aid'])).toBe('/jedi/:id');
  });

  it('returns / for empty segments', () => {
    expect(pagePathFromCatchAllSegments([])).toBe('/');
    expect(pagePathFromCatchAllSegments(undefined)).toBe('/');
  });
});

describe('defaultInstancePathFromTemplate', () => {
  it('replaces each :param with 1', () => {
    expect(defaultInstancePathFromTemplate('/jedi/:id')).toBe('/jedi/1');
    expect(defaultInstancePathFromTemplate('/test/:a/:b')).toBe('/test/1/1');
    expect(defaultInstancePathFromTemplate('/starships/:id/')).toBe('/starships/1');
  });
});

describe('isRouteTemplatePath', () => {
  it('detects :param segments', () => {
    expect(isRouteTemplatePath(JEDI)).toBe(true);
    expect(isRouteTemplatePath('/test/:a/:b')).toBe(true);
    expect(isRouteTemplatePath('/about')).toBe(false);
    expect(isRouteTemplatePath('/')).toBe(false);
  });
});

describe('matchConcretePathToTemplateParams', () => {
  it('captures params', () => {
    expect(matchConcretePathToTemplateParams('/jedi/1', JEDI)).toEqual({ id: '1' });
    expect(matchConcretePathToTemplateParams('/test/foo/bar', '/test/:a/:b')).toEqual({
      a: 'foo',
      b: 'bar',
    });
  });

  it('returns null when segment count or static segments differ', () => {
    expect(matchConcretePathToTemplateParams('/jedi/1/extra', JEDI)).toBeNull();
    expect(matchConcretePathToTemplateParams('/jedi/1', '/foo/:id')).toBeNull();
  });
});

describe('pickTemplateSourcePath', () => {
  it('maps instances to template key', () => {
    expect(pickTemplateSourcePath('/jedi/42', KEYS)).toBe(JEDI);
    expect(pickTemplateSourcePath('/starships/9', KEYS)).toBe('/starships/:id');
    expect(pickTemplateSourcePath('/test/x/y', KEYS)).toBe('/test/:a/:b');
  });

  it('returns null for the template row itself', () => {
    expect(pickTemplateSourcePath(JEDI, KEYS)).toBeNull();
  });

  it('returns null when no template matches', () => {
    expect(pickTemplateSourcePath('/about', KEYS)).toBeNull();
    expect(pickTemplateSourcePath('/jedi', KEYS)).toBeNull();
  });
});

describe('resolveTemplateMatch', () => {
  it('returns template key and params', () => {
    expect(resolveTemplateMatch('/jedi/5', KEYS)).toEqual({
      templateKey: JEDI,
      params: { id: '5' },
    });
  });
});

describe('isCanonicalTemplatePath', () => {
  it('is true when path is a known template key', () => {
    expect(isCanonicalTemplatePath(JEDI, KEYS)).toBe(true);
    expect(isCanonicalTemplatePath('/jedi/1', KEYS)).toBe(false);
  });
});

describe('templatePathParamNames', () => {
  it('lists :param names in order', () => {
    expect(templatePathParamNames('/test/:a/:b')).toEqual(['a', 'b']);
    expect(templatePathParamNames(JEDI)).toEqual(['id']);
  });
});
