// AUTO-GENERATED — DO NOT EDIT
// Source: packages/p1-starter-components/scripts/generate-catalog.mjs
// Run `pnpm registry:generate` to refresh after adding or removing a block.

import React from 'react';
import dynamic from 'next/dynamic';

// Block shape needed for preview: render component + initial prop values.
type BlockConfig = {
  render: React.ComponentType<Record<string, unknown>>;
  defaultProps?: Record<string, unknown>;
};

// Each import() uses a static string literal so the bundler code-splits per block.
function makeDynamic(loader: () => Promise<BlockConfig>): React.ComponentType {
  return dynamic(() =>
    loader().then(({ render: Render, defaultProps = {} }) => ({
      default: function BlockPreview() {
        return <Render {...defaultProps} />;
      },
    }))
  );
}

// Used by generateStaticParams() — safe to import in server context.
export const previewNames = [
  'accordion', 'announcement', 'article-header', 'button', 'callout', 'card-grid', 'columns', 'comparison-table', 'container', 'cta', 'divider', 'embed', 'faq', 'feature-media', 'features', 'figure', 'footer', 'gallery', 'header', 'heading', 'hero', 'image', 'lead-capture', 'list', 'logos', 'paragraph', 'pricing', 'pull-quote', 'quote', 'rich-text', 'spacer', 'stats', 'steps', 'tabs', 'team-grid', 'testimonial', 'timeline',
] as const;

// Category display priority for the catalog UI. Unknown categories fall back to 99.
export const CATALOG_CATEGORY_ORDER: Record<string, number> = {
  attention: 0,
  trust: 1,
  value: 2,
  showcase: 3,
  convert: 4,
  editorial: 5,
  layout: 6,
  content: 7,
  global: 8,
};

// Dynamic block map for PreviewRenderer. Each entry is code-split independently.
export const previewComponents: Record<string, React.ComponentType> = {
  'accordion': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/accordion/accordion.block')
      .then(m => m.AccordionBlock as unknown as BlockConfig)),
  'announcement': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/announcement/announcement.block')
      .then(m => m.AnnouncementBlock as unknown as BlockConfig)),
  'article-header': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/article-header/article-header.block')
      .then(m => m.ArticleHeaderBlock as unknown as BlockConfig)),
  'button': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/button/button.block')
      .then(m => m.ButtonBlock as unknown as BlockConfig)),
  'callout': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/callout/callout.block')
      .then(m => m.CalloutBlock as unknown as BlockConfig)),
  'card-grid': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/card-grid/card-grid.block')
      .then(m => m.CardGridBlock as unknown as BlockConfig)),
  'columns': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/columns/columns.block')
      .then(m => m.ColumnsBlock as unknown as BlockConfig)),
  'comparison-table': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/comparison-table/comparison-table.block')
      .then(m => m.ComparisonTableBlock as unknown as BlockConfig)),
  'container': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/container/container.block')
      .then(m => m.ContainerBlock as unknown as BlockConfig)),
  'cta': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/cta/cta.block')
      .then(m => m.CtaBannerBlock as unknown as BlockConfig)),
  'divider': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/divider/divider.block')
      .then(m => m.DividerBlock as unknown as BlockConfig)),
  'embed': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/embed/embed.block')
      .then(m => m.EmbedBlock as unknown as BlockConfig)),
  'faq': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/faq/faq.block')
      .then(m => m.FaqBlock as unknown as BlockConfig)),
  'feature-media': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/feature-media/feature-media.block')
      .then(m => m.FeatureMediaBlock as unknown as BlockConfig)),
  'features': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/features/features.block')
      .then(m => m.FeatureCardsBlock as unknown as BlockConfig)),
  'figure': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/figure/figure.block')
      .then(m => m.FigureBlock as unknown as BlockConfig)),
  'footer': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/footer/footer.block')
      .then(m => m.FooterBlock as unknown as BlockConfig)),
  'gallery': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/gallery/gallery.block')
      .then(m => m.GalleryBlock as unknown as BlockConfig)),
  'header': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/header/header.block')
      .then(m => m.HeaderBlock as unknown as BlockConfig)),
  'heading': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/heading/heading.block')
      .then(m => m.HeadingBlock as unknown as BlockConfig)),
  'hero': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/hero/hero.block')
      .then(m => m.HeroBlock as unknown as BlockConfig)),
  'image': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/image/image.block')
      .then(m => m.ImageBlock as unknown as BlockConfig)),
  'lead-capture': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/lead-capture/lead-capture.block')
      .then(m => m.LeadCaptureBlock as unknown as BlockConfig)),
  'list': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/list/list.block')
      .then(m => m.ListBlock as unknown as BlockConfig)),
  'logos': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/logos/logos.block')
      .then(m => m.LogoCloudBlock as unknown as BlockConfig)),
  'paragraph': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/paragraph/paragraph.block')
      .then(m => m.ParagraphBlock as unknown as BlockConfig)),
  'pricing': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/pricing/pricing.block')
      .then(m => m.PricingBlock as unknown as BlockConfig)),
  'pull-quote': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/pull-quote/pull-quote.block')
      .then(m => m.PullQuoteBlock as unknown as BlockConfig)),
  'quote': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/quote/quote.block')
      .then(m => m.QuoteBlock as unknown as BlockConfig)),
  'rich-text': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/rich-text/rich-text.block')
      .then(m => m.RichTextBlock as unknown as BlockConfig)),
  'spacer': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/spacer/spacer.block')
      .then(m => m.SpacerBlock as unknown as BlockConfig)),
  'stats': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/stats/stats.block')
      .then(m => m.StatsBlock as unknown as BlockConfig)),
  'steps': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/steps/steps.block')
      .then(m => m.StepsBlock as unknown as BlockConfig)),
  'tabs': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/tabs/tabs.block')
      .then(m => m.TabsBlock as unknown as BlockConfig)),
  'team-grid': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/team-grid/team-grid.block')
      .then(m => m.TeamGridBlock as unknown as BlockConfig)),
  'testimonial': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/testimonial/testimonial.block')
      .then(m => m.TestimonialBlock as unknown as BlockConfig)),
  'timeline': makeDynamic(() =>
    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/timeline/timeline.block')
      .then(m => m.TimelineBlock as unknown as BlockConfig)),
};
