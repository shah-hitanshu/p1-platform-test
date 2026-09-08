import type { ReactNode } from "react";
import {
  createSeoRootFields,
  DEFAULT_EDITOR_ROOT_TITLE,
} from "@pantheon-systems/puck-css/seo";

/**
 * The root config: this site's own fields, plus the page-metadata fields.
 *
 * Title and description are yours to change — they are the site's content. The
 * `_meta` field set is not composed here by hand: it writes a stored shape the
 * head tags read back, so it comes from the package that owns that shape and
 * versions with it.
 */

const buildFields = (rootProps?: Record<string, unknown>) => ({
  title: { type: "text" as const },
  description: { type: "textarea" as const },
  ...createSeoRootFields(rootProps),
});

export const puckRoot = {
  fields: buildFields(),
  /**
   * Passing the live root props is what lets the metadata fields show what an
   * empty one will inherit — the fields slice subscribes to the root node, so
   * changing the title re-resolves the placeholders.
   */
  resolveFields: (data: { props?: Record<string, unknown> }) =>
    buildFields(data.props ?? {}),
  defaultProps: {
    title: DEFAULT_EDITOR_ROOT_TITLE,
  },
  render: (props: { children?: ReactNode; title?: string }) => {
    const { children } = props;
    return (
      <div className="font-sans antialiased">
        {children}
      </div>
    );
  },
};
