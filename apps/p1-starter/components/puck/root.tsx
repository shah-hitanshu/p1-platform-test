import type { ReactNode } from "react";
import { OG_TYPES, TWITTER_CARDS } from "../../lib/seo-metadata.consts";

/**
 * Fixed-vocabulary fields are dropdowns built from the lists buildPageMetadata
 * validates against, so an option cannot drift from what reaches the tag.
 *
 * The default option's value is empty rather than the default itself. Storing it
 * would freeze a value into every page, and a page carrying an explicit `website`
 * can never pick up a template default later — so the label states the outcome
 * while the data stays uncommitted.
 */
const OG_TYPE_LABELS: Record<(typeof OG_TYPES)[number], string> = {
  website: "Website",
  article: "Article",
  book: "Book",
  profile: "Profile",
};

const TWITTER_CARD_LABELS: Record<(typeof TWITTER_CARDS)[number], string> = {
  summary: "Summary",
  summary_large_image: "Summary with large image",
  player: "Player",
  app: "App",
};

const optionsWithDefault = <T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
  defaultLabel: string,
) => [
  { label: `${defaultLabel} (default)`, value: "" },
  ...values.map((value) => ({ label: labels[value], value: value as string })),
];

// buildPageMetadata picks the large card when there is an image, so the default
// option names whichever one an empty field will actually get.
const twitterCardOptions = (defaultLabel: string) =>
  optionsWithDefault(TWITTER_CARDS, TWITTER_CARD_LABELS, defaultLabel);

/**
 * Page metadata values are stored at `root.props._meta`, so they are
 * branch-scoped and versioned like any other authored content. An empty field
 * inherits at render time rather than being copied on create.
 *
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

// Boilerplate from defaultProps: never offered as an inherited value, matching
// the head tags, which refuse to ship it.
const DEFAULT_EDITOR_TITLE = "My Puck Editor";

const inheritedFrom = (value: unknown): string | undefined => {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text !== DEFAULT_EDITOR_TITLE ? text : undefined;
};

const withPlaceholder = <T extends object>(field: T, placeholder?: string): T =>
  placeholder ? { ...field, placeholder } : field;

interface InheritedValues {
  ogTitle?: string;
  ogDescription?: string;
  twitterTitle?: string;
  twitterImage?: string;
  twitterCardDefault?: string;
}

const buildFields = (inherited: InheritedValues = {}) => ({
  title: { type: "text" as const },
  description: { type: "textarea" as const },
  _meta: {
    type: "object" as const,
    label: "Social & sharing",
    metadata: { collapsible: true, defaultCollapsed: true },
    objectFields: {
      ...metadataFields,
      ogTitle: withPlaceholder(metadataFields.ogTitle, inherited.ogTitle),
      ogDescription: withPlaceholder(metadataFields.ogDescription, inherited.ogDescription),
      twitterTitle: withPlaceholder(metadataFields.twitterTitle, inherited.twitterTitle),
      twitterImage: withPlaceholder(metadataFields.twitterImage, inherited.twitterImage),
      twitterCard: inherited.twitterCardDefault
        ? {
            ...metadataFields.twitterCard,
            options: twitterCardOptions(inherited.twitterCardDefault),
          }
        : metadataFields.twitterCard,
    },
  },
});

export const puckRoot = {
  fields: buildFields(),
  /**
   * Shows what an empty field will inherit, as a placeholder. It has to be a
   * placeholder and not a value: autosave persists the whole snapshot, so a
   * derived value written into the field would be saved and the field would stop
   * inheriting for good.
   *
   * Reading the source from root props is what makes this track edits — the
   * fields slice subscribes to the root node, so changing the title re-resolves.
   * The same is not true of Puck's `metadata`, which is why the site and
   * template default tiers cannot be shown this way.
   *
   * The chains mirror buildPageMetadata in lib/seo-metadata.ts. A placeholder
   * that disagreed with what the head actually emits would be worse than none.
   */
  resolveFields: (data: { props?: Record<string, unknown> }) => {
    const props = data.props ?? {};
    const meta = (props._meta ?? {}) as Record<string, unknown>;
    const title = inheritedFrom(props.title);
    const ogTitle = inheritedFrom(meta.ogTitle) ?? title;
    const image = inheritedFrom(meta.twitterImage) ?? inheritedFrom(meta.ogImage);

    return buildFields({
      ogTitle: title,
      ogDescription: inheritedFrom(props.description),
      twitterTitle: ogTitle,
      twitterImage: inheritedFrom(meta.ogImage),
      twitterCardDefault: image
        ? TWITTER_CARD_LABELS.summary_large_image
        : TWITTER_CARD_LABELS.summary,
    });
  },
  defaultProps: {
    title: DEFAULT_EDITOR_TITLE,
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
