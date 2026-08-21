/**
 * Dev-only barrel. Storybook, the catalog app and the invariant tests enumerate
 * blocks through here. It is NOT part of any registry item and never reaches a
 * user's project — the code registry distributes each block's files directly.
 */
import type { Config } from "@puckeditor/core";

// ── Global chrome ──────────────────────────────────────────
import { HeaderBlock } from "./header/header";
import { FooterBlock } from "./footer/footer";
// ── Attention ──────────────────────────────────────────────
import { HeroBlock } from "./hero/hero";
import { AnnouncementBlock } from "./announcement/announcement";
// ── Trust ──────────────────────────────────────────────────
import { LogoCloudBlock } from "./logos/logos.block";
import { TestimonialBlock } from "./testimonial/testimonial.block";
import { StatsBlock } from "./stats/stats.block";
import { TeamGridBlock } from "./team-grid/team-grid.block";
// ── Value ──────────────────────────────────────────────────
import { FeatureCardsBlock } from "./features/features.block";
import { FeatureMediaBlock } from "./feature-media/feature-media.block";
import { StepsBlock } from "./steps/steps.block";
import { TimelineBlock } from "./timeline/timeline.block";
// ── Showcase ───────────────────────────────────────────────
import { CardGridBlock } from "./card-grid/card-grid.block";
import { ImageBlock } from "./image/image.block";
import { GalleryBlock } from "./gallery/gallery.block";
// ── Convert ────────────────────────────────────────────────
import { PricingBlock } from "./pricing/pricing";
import { FaqBlock } from "./faq/faq";
import { LeadCaptureBlock } from "./lead-capture/lead-capture";
import { CtaBannerBlock } from "./cta/cta";
import { ComparisonTableBlock } from "./comparison-table/comparison-table";
// ── Editorial ──────────────────────────────────────────────
import { ArticleHeaderBlock } from "./article-header/article-header.block";
import { RichTextBlock } from "./rich-text/rich-text.block";
import { FigureBlock } from "./figure/figure.block";
import { PullQuoteBlock } from "./pull-quote/pull-quote.block";
import { EmbedBlock } from "./embed/embed.block";
import { CalloutBlock } from "./callout/callout.block";
// ── Layout ─────────────────────────────────────────────────
import { ColumnsBlock } from "./columns/columns.block";
import { ContainerBlock } from "./container/container.block";
import { TabsBlock } from "./tabs/tabs.block";
import { AccordionBlock } from "./accordion/accordion.block";
// ── Content ────────────────────────────────────────────────
import { HeadingBlock } from "./heading/heading.block";
import { ParagraphBlock } from "./paragraph/paragraph.block";
import { QuoteBlock } from "./quote/quote.block";
import { ListBlock } from "./list/list.block";
import { ButtonBlock } from "./button/button.block";
import { DividerBlock } from "./divider/divider.block";
import { SpacerBlock } from "./spacer/spacer.block";

// Re-export every component config
export {
  // Global
  HeaderBlock,
  FooterBlock,
  // Attention
  HeroBlock,
  AnnouncementBlock,
  // Trust
  LogoCloudBlock,
  TestimonialBlock,
  StatsBlock,
  TeamGridBlock,
  // Value
  FeatureCardsBlock,
  FeatureMediaBlock,
  StepsBlock,
  TimelineBlock,
  // Showcase
  CardGridBlock,
  ImageBlock,
  GalleryBlock,
  // Convert
  PricingBlock,
  FaqBlock,
  LeadCaptureBlock,
  CtaBannerBlock,
  ComparisonTableBlock,
  // Editorial
  ArticleHeaderBlock,
  RichTextBlock,
  FigureBlock,
  PullQuoteBlock,
  EmbedBlock,
  CalloutBlock,
  // Layout
  ColumnsBlock,
  ContainerBlock,
  TabsBlock,
  AccordionBlock,
  // Content
  HeadingBlock,
  ParagraphBlock,
  QuoteBlock,
  ListBlock,
  ButtonBlock,
  DividerBlock,
  SpacerBlock,
};

// Convenience map — pass to Puck's `components`. Not distributed; see jsdoc above.
export const allBlocks = {
  HeaderBlock,
  FooterBlock,
  HeroBlock,
  AnnouncementBlock,
  LogoCloudBlock,
  TestimonialBlock,
  StatsBlock,
  TeamGridBlock,
  FeatureCardsBlock,
  FeatureMediaBlock,
  StepsBlock,
  TimelineBlock,
  CardGridBlock,
  ImageBlock,
  GalleryBlock,
  PricingBlock,
  FaqBlock,
  LeadCaptureBlock,
  CtaBannerBlock,
  ComparisonTableBlock,
  ArticleHeaderBlock,
  RichTextBlock,
  FigureBlock,
  PullQuoteBlock,
  EmbedBlock,
  CalloutBlock,
  ColumnsBlock,
  ContainerBlock,
  TabsBlock,
  AccordionBlock,
  HeadingBlock,
  ParagraphBlock,
  QuoteBlock,
  ListBlock,
  ButtonBlock,
  DividerBlock,
  SpacerBlock,
};

// Category configuration for the Puck component drawer.
export const sourceCategories: Config["categories"] = {
  Global: { title: "Global", components: ["HeaderBlock", "FooterBlock"] },
  Attention: { title: "Attention", components: ["HeroBlock", "AnnouncementBlock"] },
  Trust: { title: "Trust", components: ["LogoCloudBlock", "TestimonialBlock", "StatsBlock", "TeamGridBlock"] },
  Value: { title: "Value", components: ["FeatureCardsBlock", "FeatureMediaBlock", "StepsBlock", "TimelineBlock"] },
  Showcase: { title: "Showcase", components: ["CardGridBlock", "ImageBlock", "GalleryBlock"] },
  Convert: {
    title: "Convert",
    components: ["PricingBlock", "FaqBlock", "LeadCaptureBlock", "CtaBannerBlock", "ComparisonTableBlock"],
  },
  Editorial: {
    title: "Editorial",
    components: ["ArticleHeaderBlock", "RichTextBlock", "FigureBlock", "PullQuoteBlock", "EmbedBlock", "CalloutBlock"],
  },
  Layout: {
    title: "Layout",
    components: ["ColumnsBlock", "ContainerBlock", "TabsBlock", "AccordionBlock"],
  },
  Content: {
    title: "Content",
    components: ["HeadingBlock", "ParagraphBlock", "QuoteBlock", "ListBlock", "ButtonBlock", "DividerBlock", "SpacerBlock"],
  },
};
