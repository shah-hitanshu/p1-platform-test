/**
 * The public shape of the editor client factory's options.
 *
 * Kept apart from the factory so the surface an app writes against reads as one
 * document, and so adding a slot means editing the contract rather than
 * threading a type through the implementation.
 */

import type React from "react";
import type { Config, Plugin } from "@puckeditor/core";
import type {
  ContentRole,
  UseP1EditorOptions,
  UseP1OverridesOptions,
} from "@pantheon-systems/puck-css";

export type EditorPluginOptions = NonNullable<UseP1EditorOptions["pluginOptions"]>;

/**
 * What a customization slot is told about the editor as it renders.
 */
export type P1EditorContext = {
  /** Path of the document currently open in the editor. */
  path: string;
  /** Opens another document in the editor, keeping the editor shell mounted. */
  openDocument: (documentPath: string) => void;
};

/**
 * Editor customizations an app can only work out at render time. Each field is
 * merged over its static counterpart in the factory options.
 */
export type P1EditorExtensions = {
  /**
   * Extra Puck plugins, appended after the ones P1 supplies and after any
   * static `plugins`. Return a stable array — a new array identity remounts the
   * whole canvas, so memoize it against whatever it actually depends on.
   */
  plugins?: Plugin[];
  /** Merged over the default and static plugin options. */
  pluginOptions?: Partial<EditorPluginOptions>;
  /** Merged over the default and static override options. */
  overrideOptions?: UseP1OverridesOptions;
  /**
   * Appended to the canvas key. Puck holds editor state internally, so changing
   * this string is how an app forces a clean remount when something outside
   * Puck's own inputs changes shape.
   */
  editorKeySuffix?: string;
};

export type CreateP1EditorClientOptions = {
  /**
   * The app's Puck config — its component set. Wrapped for editor preview
   * before it reaches the canvas, so pass the same config the published pages
   * render with.
   */
  puckConfig: Config;
  /**
   * Shown in place of the editor until the user signs in. Omit to get the
   * built-in sign-in page.
   */
  signInPage?: React.ReactElement;
  /** Extra Puck plugins, appended after the ones P1 supplies. */
  plugins?: Plugin[];
  /**
   * Overrides for the P1 plugin's own options. Merged over the defaults, which
   * already wire document selection, the open document, the site id and the
   * dashboard link.
   */
  pluginOptions?: Partial<EditorPluginOptions>;
  /**
   * Overrides for the editor's header actions. Merged over the defaults, which
   * leave the publish button to the app.
   */
  overrideOptions?: UseP1OverridesOptions;
  /**
   * The one slot that may use hooks: it is called while the editor renders, so
   * customizations that depend on a feature flag, a role, or anything else only
   * a hook can supply have somewhere to read it. Give it a name starting with
   * `use` and obey the rules of hooks — unconditional, same order every render.
   */
  useExtensions?: (ctx: P1EditorContext) => P1EditorExtensions;
  /**
   * Wraps the editor in app-owned context providers. Rendered inside the auth
   * gate, so it only mounts for a signed-in user.
   */
  wrapEditor?: (children: React.ReactNode) => React.ReactNode;
  /** The content role the editor starts in. Defaults to `editor`. */
  userRole?: ContentRole;
  /**
   * Shows the role picker, which re-renders the editor as another content role.
   * A development affordance — gate it on an env var rather than shipping it to
   * production readers.
   */
  roleSwitcher?: boolean;
};
