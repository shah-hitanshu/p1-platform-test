// AUTO-GENERATED — DO NOT EDIT
// Source: packages/p1-starter-components/scripts/generate-catalog.mjs
// Run `pnpm registry:generate` to refresh after adding or removing a block.

/**
 * Dev-only barrel. Storybook, the catalog app and the invariant tests enumerate
 * blocks through here. It is NOT part of any registry item and never reaches a
 * user's project — the code registry distributes each block's files directly.
 */
import type { Config } from "@puckeditor/core";

// ── Global ────────────────────────────────────────────────
import { FooterBlock } from "./footer/footer.block";
import { HeaderBlock } from "./header/header.block";
// ── Attention ─────────────────────────────────────────────
import { AnnouncementBlock } from "./announcement/announcement.block";
import { HeroBlock } from "./hero/hero.block";
// ── Trust ─────────────────────────────────────────────────
import { LogoCloudBlock } from "./logos/logos.block";
import { StatsBlock } from "./stats/stats.block";
import { TeamGridBlock } from "./team-grid/team-grid.block";
import { TestimonialBlock } from "./testimonial/testimonial.block";
// ── Value ─────────────────────────────────────────────────
import { FeatureMediaBlock } from "./feature-media/feature-media.block";
import { FeatureCardsBlock } from "./features/features.block";
import { StepsBlock } from "./steps/steps.block";
import { TimelineBlock } from "./timeline/timeline.block";
// ── Showcase ──────────────────────────────────────────────
import { CardGridBlock } from "./card-grid/card-grid.block";
import { GalleryBlock } from "./gallery/gallery.block";
import { ImageBlock } from "./image/image.block";
// ── Convert ───────────────────────────────────────────────
import { ComparisonTableBlock } from "./comparison-table/comparison-table.block";
import { CtaBannerBlock } from "./cta/cta.block";
import { FaqBlock } from "./faq/faq.block";
import { LeadCaptureBlock } from "./lead-capture/lead-capture.block";
import { PricingBlock } from "./pricing/pricing.block";
// ── Editorial ─────────────────────────────────────────────
import { ArticleHeaderBlock } from "./article-header/article-header.block";
import { CalloutBlock } from "./callout/callout.block";
import { EmbedBlock } from "./embed/embed.block";
import { FigureBlock } from "./figure/figure.block";
import { PullQuoteBlock } from "./pull-quote/pull-quote.block";
import { RichTextBlock } from "./rich-text/rich-text.block";
// ── Layout ────────────────────────────────────────────────
import { AccordionBlock } from "./accordion/accordion.block";
import { ColumnsBlock } from "./columns/columns.block";
import { ContainerBlock } from "./container/container.block";
import { TabsBlock } from "./tabs/tabs.block";
// ── Content ───────────────────────────────────────────────
import { ButtonBlock } from "./button/button.block";
import { DividerBlock } from "./divider/divider.block";
import { HeadingBlock } from "./heading/heading.block";
import { ListBlock } from "./list/list.block";
import { ParagraphBlock } from "./paragraph/paragraph.block";
import { QuoteBlock } from "./quote/quote.block";
import { SpacerBlock } from "./spacer/spacer.block";

// Re-export every component config
export {
  FooterBlock,
  HeaderBlock,
  AnnouncementBlock,
  HeroBlock,
  LogoCloudBlock,
  StatsBlock,
  TeamGridBlock,
  TestimonialBlock,
  FeatureMediaBlock,
  FeatureCardsBlock,
  StepsBlock,
  TimelineBlock,
  CardGridBlock,
  GalleryBlock,
  ImageBlock,
  ComparisonTableBlock,
  CtaBannerBlock,
  FaqBlock,
  LeadCaptureBlock,
  PricingBlock,
  ArticleHeaderBlock,
  CalloutBlock,
  EmbedBlock,
  FigureBlock,
  PullQuoteBlock,
  RichTextBlock,
  AccordionBlock,
  ColumnsBlock,
  ContainerBlock,
  TabsBlock,
  ButtonBlock,
  DividerBlock,
  HeadingBlock,
  ListBlock,
  ParagraphBlock,
  QuoteBlock,
  SpacerBlock,
};

// Convenience map — pass to Puck's `components`. Not distributed; see jsdoc above.
export const allBlocks = {
  FooterBlock,
  HeaderBlock,
  AnnouncementBlock,
  HeroBlock,
  LogoCloudBlock,
  StatsBlock,
  TeamGridBlock,
  TestimonialBlock,
  FeatureMediaBlock,
  FeatureCardsBlock,
  StepsBlock,
  TimelineBlock,
  CardGridBlock,
  GalleryBlock,
  ImageBlock,
  ComparisonTableBlock,
  CtaBannerBlock,
  FaqBlock,
  LeadCaptureBlock,
  PricingBlock,
  ArticleHeaderBlock,
  CalloutBlock,
  EmbedBlock,
  FigureBlock,
  PullQuoteBlock,
  RichTextBlock,
  AccordionBlock,
  ColumnsBlock,
  ContainerBlock,
  TabsBlock,
  ButtonBlock,
  DividerBlock,
  HeadingBlock,
  ListBlock,
  ParagraphBlock,
  QuoteBlock,
  SpacerBlock,
};

// Category configuration for the Puck component drawer.
export const sourceCategories: Config["categories"] = {
  Global: { title: "Global", components: ["FooterBlock", "HeaderBlock"] },
  Attention: { title: "Attention", components: ["AnnouncementBlock", "HeroBlock"] },
  Trust: { title: "Trust", components: ["LogoCloudBlock", "StatsBlock", "TeamGridBlock", "TestimonialBlock"] },
  Value: { title: "Value", components: ["FeatureMediaBlock", "FeatureCardsBlock", "StepsBlock", "TimelineBlock"] },
  Showcase: { title: "Showcase", components: ["CardGridBlock", "GalleryBlock", "ImageBlock"] },
  Convert: { title: "Convert", components: ["ComparisonTableBlock", "CtaBannerBlock", "FaqBlock", "LeadCaptureBlock", "PricingBlock"] },
  Editorial: { title: "Editorial", components: ["ArticleHeaderBlock", "CalloutBlock", "EmbedBlock", "FigureBlock", "PullQuoteBlock", "RichTextBlock"] },
  Layout: { title: "Layout", components: ["AccordionBlock", "ColumnsBlock", "ContainerBlock", "TabsBlock"] },
  Content: { title: "Content", components: ["ButtonBlock", "DividerBlock", "HeadingBlock", "ListBlock", "ParagraphBlock", "QuoteBlock", "SpacerBlock"] },
};
