import { describe, it, expect } from 'vitest';
import { templatePagePath } from './template-path.js';

const label = 'Blog post';

describe('templatePagePath', () => {
  it('leaves a path alone when the template has no route shape', () => {
    expect(templatePagePath(undefined, 'about', label)).toBe('about');
    expect(templatePagePath('', '/about', label)).toBe('/about');
  });

  it('leaves a path that already fits the shape untouched', () => {
    expect(templatePagePath('/blog/:slug', '/blog/hello-world', label)).toBe('/blog/hello-world');
    expect(templatePagePath('/blog/:slug', 'blog/hello-world', label)).toBe('blog/hello-world');
  });

  // The Create Page dialog collects the slug before the template is chosen, so this is the shape
  // of every path the agent is handed for a page it then builds from a template.
  it('places a bare slug under the shape', () => {
    expect(templatePagePath('/blog/:slug', '/hello-world', label)).toBe('/blog/hello-world');
  });

  it('keeps the caller\'s leading-slash convention', () => {
    expect(templatePagePath('/blog/:slug', 'hello-world', label)).toBe('blog/hello-world');
  });

  it('moves a page filed under the wrong prefix', () => {
    expect(templatePagePath('/blog/:slug', '/news/hello-world', label)).toBe('/blog/hello-world');
  });

  it('fills every param of a multi-segment shape from the trailing segments', () => {
    expect(templatePagePath('/:category/:slug', '/tech/hello', label)).toBe('/tech/hello');
    expect(templatePagePath('/blog/:year/archive/:slug', '/blog/2026/hello', label))
      .toBe('/blog/2026/archive/hello');
  });

  // Inventing one would file the page under a category nobody chose.
  it('refuses a path with fewer segments than the shape has params', () => {
    expect(() => templatePagePath('/:category/:slug', '/hello', label))
      .toThrow(/does not fill every segment of it \(category, slug\)/);
  });

  it('names the template and the shape, so the agent can ask for what is missing', () => {
    expect(() => templatePagePath('/blog/:slug', '/blog', label))
      .toThrow(/"Blog post" template's pages live at \/blog\/:slug/);
  });

  it('does not mistake a slug that repeats a static segment for the segment itself', () => {
    expect(templatePagePath('/blog/:slug', '/blog/blog', label)).toBe('/blog/blog');
  });

  // A pattern with no params names one fixed path, so it cannot be the shape of a set of pages —
  // and rewriting every page to it would collide on the second one.
  it('ignores a pattern that has no params', () => {
    expect(templatePagePath('/blog', '/hello-world', label)).toBe('/hello-world');
  });

  it('refuses the root path, which supplies nothing to fill the shape with', () => {
    expect(() => templatePagePath('/blog/:slug', '/', label)).toThrow(/does not fill/);
  });
});
