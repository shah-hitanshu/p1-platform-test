/**
 * The page-metadata field set for the Puck root config.
 *
 * Values live at `root.props._meta` in the page snapshot — branch-scoped,
 * versioned and autosaved like any other authored content. The stored shape is
 * defined alongside these fields, so the editor fields that write it are
 * versioned with it: a field set copied into a project could not follow the
 * shape as it evolved.
 *
 * The built-in field set is fixed: no admin-defined fields, no template or site
 * tiers. Fields are declared flat inside one `_meta` object field — grouping
 * them would nest object fields, deepening the prop paths the root-prop
 * migration applier has to handle. A site is free to merge its own field onto
 * the returned group; it templates like the rest and reaches `<head>` through
 * the renderer's `transform`.
 */

import type { OgType, TwitterCard } from "./types.js";
import {
  OG_TYPES,
  TWITTER_CARDS,
  DEFAULT_EDITOR_ROOT_TITLE,
} from "./consts.js";

const OG_TYPE_LABELS: Record<OgType, string> = {
  website: "Website",
  article: "Article",
  book: "Book",
  profile: "Profile",
};

const TWITTER_CARD_LABELS: Record<TwitterCard, string> = {
  summary: "Summary",
  summary_large_image: "Summary with large image",
  player: "Player",
  app: "App",
};

/**
 * The default option's value is empty rather than the default itself. Storing
 * it would freeze a value into every page, and a page carrying an explicit
 * `website` can never pick up a template default later — so the label states
 * the outcome while the data stays uncommitted.
 */
const optionsWithDefault = <T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
  defaultLabel: string,
) => [
  { label: `${defaultLabel} (default)`, value: "" },
  ...values.map((value) => ({ label: labels[value], value: value as string })),
];

// The renderer picks the large card when there is an image, so the default
// option names whichever one an empty field will actually get.
const twitterCardOptions = (defaultLabel: string) =>
  optionsWithDefault(TWITTER_CARDS, TWITTER_CARD_LABELS, defaultLabel);

/**
 * Labels are the tag names themselves, not friendly rewrites. Someone editing
 * these is working from an SEO or social checklist that names the tags, and a
 * label like "Social title" makes them guess which tag it writes.
 */
const metadataFields = {
  ogTitle: {
    type: "text" as const,
    label: "og:title",
    metadata: {
      help: "The headline shown when this page is shared.",
      helpWhenEmpty: "Inherited from title. Edit to override.",
    },
  },
  ogDescription: {
    type: "textarea" as const,
    label: "og:description",
    metadata: {
      help: "The summary shown beneath the headline when this page is shared.",
      helpWhenEmpty: "Inherited from description. Edit to override.",
    },
  },
  ogType: {
    type: "select" as const,
    label: "og:type",
    options: optionsWithDefault(OG_TYPES, OG_TYPE_LABELS, "Website"),
    metadata: { help: "How this page is described when shared. Most pages are a website." },
  },
  ogImage: {
    type: "text" as const,
    label: "og:image",
    metadata: {
      help: "Full URL to the preview image. A relative path resolves against the site URL.",
    },
  },
  ogLocale: {
    type: "text" as const,
    label: "og:locale",
    metadata: { help: "Language and region of this page, such as en_US." },
  },
  // Without twitter:card, X renders no card at all and the two fields below are inert.
  twitterCard: {
    type: "select" as const,
    label: "twitter:card",
    options: twitterCardOptions("Summary"),
    metadata: {
      help: "How the card is laid out on X. Player and app cards need tags this site does not render.",
    },
  },
  twitterTitle: {
    type: "text" as const,
    label: "twitter:title",
    metadata: {
      help: "The headline shown on X.",
      helpWhenEmpty: "Inherited from og:title, then title. Edit to override.",
    },
  },
  twitterImage: {
    type: "text" as const,
    label: "twitter:image",
    metadata: {
      help: "Full URL to the image shown on X.",
      helpWhenEmpty: "Inherited from og:image. Edit to override.",
    },
  },
};

const inheritedFrom = (value: unknown): string | undefined => {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text !== DEFAULT_EDITOR_ROOT_TITLE ? text : undefined;
};

const withPlaceholder = <T extends object>(field: T, placeholder?: string): T =>
  placeholder ? { ...field, placeholder } : field;

/**
 * The `_meta` field for a root config's `fields`.
 *
 * Pass the live root props from `resolveFields` to show what an empty field
 * will inherit, as a placeholder. It has to be a placeholder and not a value:
 * autosave persists the whole snapshot, so a derived value written into the
 * field would be saved and the field would stop inheriting for good. Reading
 * the source from root props is what makes it track edits — the fields slice
 * subscribes to the root node, so changing the title re-resolves.
 *
 * The chains mirror what the head tags actually emit: `twitter:title` from
 * `og:title` before `title`, `twitter:image` from `og:image`. A placeholder
 * that disagreed with the rendered tag would be worse than none. The site
 * default tier cannot be shown this way, since it does not live in root props.
 *
 * No `defaultProps` companion: an unset field falls back at render time, and a
 * default here would freeze boilerplate metadata into every new page.
 */
export function createSeoRootFields(rootProps?: Record<string, unknown>) {
  const props = rootProps ?? {};
  const meta = (props._meta ?? {}) as Record<string, unknown>;
  const title = inheritedFrom(props.title);
  const ogTitle = inheritedFrom(meta.ogTitle) ?? title;
  const image = inheritedFrom(meta.twitterImage) ?? inheritedFrom(meta.ogImage);
  const twitterCardDefault = rootProps
    ? image
      ? TWITTER_CARD_LABELS.summary_large_image
      : TWITTER_CARD_LABELS.summary
    : undefined;

  return {
    _meta: {
      type: "object" as const,
      label: "Social & sharing",
      metadata: { collapsible: true, defaultCollapsed: true },
      objectFields: {
        ...metadataFields,
        ogTitle: withPlaceholder(metadataFields.ogTitle, title),
        ogDescription: withPlaceholder(
          metadataFields.ogDescription,
          inheritedFrom(props.description),
        ),
        twitterTitle: withPlaceholder(metadataFields.twitterTitle, ogTitle),
        twitterImage: withPlaceholder(
          metadataFields.twitterImage,
          inheritedFrom(meta.ogImage),
        ),
        twitterCard: twitterCardDefault
          ? {
              ...metadataFields.twitterCard,
              options: twitterCardOptions(twitterCardDefault),
            }
          : metadataFields.twitterCard,
      },
    },
  };
}
