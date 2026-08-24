import { allBlocks } from '@pantheon-systems/p1-starter-components/registry/p1/blocks/index';

// Explicit map: kebab-case registry name → allBlocks key.
// Three names deviate from the simple pascal pattern (logos, features, cta).
const NAME_TO_KEY: Record<string, keyof typeof allBlocks> = {
  accordion: 'AccordionBlock',
  announcement: 'AnnouncementBlock',
  'article-header': 'ArticleHeaderBlock',
  button: 'ButtonBlock',
  callout: 'CalloutBlock',
  'card-grid': 'CardGridBlock',
  'comparison-table': 'ComparisonTableBlock',
  columns: 'ColumnsBlock',
  container: 'ContainerBlock',
  cta: 'CtaBannerBlock',
  divider: 'DividerBlock',
  embed: 'EmbedBlock',
  faq: 'FaqBlock',
  'feature-media': 'FeatureMediaBlock',
  features: 'FeatureCardsBlock',
  figure: 'FigureBlock',
  footer: 'FooterBlock',
  gallery: 'GalleryBlock',
  header: 'HeaderBlock',
  heading: 'HeadingBlock',
  hero: 'HeroBlock',
  image: 'ImageBlock',
  'lead-capture': 'LeadCaptureBlock',
  list: 'ListBlock',
  logos: 'LogoCloudBlock',
  paragraph: 'ParagraphBlock',
  pricing: 'PricingBlock',
  'pull-quote': 'PullQuoteBlock',
  quote: 'QuoteBlock',
  'rich-text': 'RichTextBlock',
  spacer: 'SpacerBlock',
  stats: 'StatsBlock',
  steps: 'StepsBlock',
  tabs: 'TabsBlock',
  'team-grid': 'TeamGridBlock',
  testimonial: 'TestimonialBlock',
  timeline: 'TimelineBlock',
};

export type BlockConfig = {
  render: React.ComponentType<Record<string, unknown>>;
  defaultProps?: Record<string, unknown>;
};

export const previewNames = Object.keys(NAME_TO_KEY);

export function getBlockConfig(name: string): BlockConfig | null {
  const key = NAME_TO_KEY[name];
  if (!key) return null;
  return allBlocks[key] as unknown as BlockConfig;
}
