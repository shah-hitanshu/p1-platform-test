import type { Config } from "@puckeditor/core";

// ── Global chrome ──────────────────────────────────────────
import { HeaderBlock } from "./blocks/header";
import { FooterBlock } from "./blocks/footer";
// ── Attention ──────────────────────────────────────────────
import { HeroBlock } from "./blocks/hero";
import { AnnouncementBlock } from "./blocks/announcement";
// ── Trust ──────────────────────────────────────────────────
import { LogoCloudBlock } from "./blocks/logos";
import { TestimonialBlock } from "./blocks/testimonial";
import { StatsBlock } from "./blocks/stats";
import { TeamGridBlock } from "./blocks/team-grid";
// ── Value ──────────────────────────────────────────────────
import { FeatureCardsBlock } from "./blocks/features";
import { FeatureMediaBlock } from "./blocks/feature-media";
import { StepsBlock } from "./blocks/steps";
import { TimelineBlock } from "./blocks/timeline";
// ── Showcase ───────────────────────────────────────────────
import { CardGridBlock } from "./blocks/card-grid";
import { ImageBlock } from "./blocks/image";
import { GalleryBlock } from "./blocks/gallery";
// ── Convert ────────────────────────────────────────────────
import { PricingBlock } from "./blocks/pricing";
import { FaqBlock } from "./blocks/faq";
import { LeadCaptureBlock } from "./blocks/lead-capture";
import { CtaBannerBlock } from "./blocks/cta";
import { ComparisonTableBlock } from "./blocks/comparison-table";
// ── Editorial ──────────────────────────────────────────────
import { ArticleHeaderBlock } from "./blocks/article-header";
import { RichTextBlock } from "./blocks/rich-text";
import { FigureBlock } from "./blocks/figure";
import { PullQuoteBlock } from "./blocks/pull-quote";
import { EmbedBlock } from "./blocks/embed";
import { CalloutBlock } from "./blocks/callout";
// ── Layout ─────────────────────────────────────────────────
import { ColumnsBlock } from "./blocks/columns";
import { ContainerBlock } from "./blocks/container";
import { TabsBlock } from "./blocks/tabs";
import { AccordionBlock } from "./blocks/accordion";
// ── Content ────────────────────────────────────────────────
import { HeadingBlock } from "./blocks/heading";
import { ParagraphBlock } from "./blocks/paragraph";
import { QuoteBlock } from "./blocks/quote";
import { ListBlock } from "./blocks/list";
import { ButtonBlock } from "./blocks/button";
import { DividerBlock } from "./blocks/divider";
import { SpacerBlock } from "./blocks/spacer";

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

// Convenience map of the full block library — pass to Puck's `components`.
export const marketingBlocks = {
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
export const secondaryLibraryCategories: Config["categories"] = {
  "🌐 Global": { title: "Global", components: ["HeaderBlock", "FooterBlock"] },
  "🎯 Attention": { title: "Attention", components: ["HeroBlock", "AnnouncementBlock"] },
  "🤝 Trust": { title: "Trust", components: ["LogoCloudBlock", "TestimonialBlock", "StatsBlock", "TeamGridBlock"] },
  "💎 Value": { title: "Value", components: ["FeatureCardsBlock", "FeatureMediaBlock", "StepsBlock", "TimelineBlock"] },
  "🖼️ Showcase": { title: "Showcase", components: ["CardGridBlock", "ImageBlock", "GalleryBlock"] },
  "🚀 Convert": {
    title: "Convert",
    components: ["PricingBlock", "FaqBlock", "LeadCaptureBlock", "CtaBannerBlock", "ComparisonTableBlock"],
  },
  "📰 Editorial": {
    title: "Editorial",
    components: ["ArticleHeaderBlock", "RichTextBlock", "FigureBlock", "PullQuoteBlock", "EmbedBlock", "CalloutBlock"],
  },
  "🧱 Layout": {
    title: "Layout",
    components: ["ColumnsBlock", "ContainerBlock", "TabsBlock", "AccordionBlock"],
  },
  "✍️ Content": {
    title: "Content",
    components: ["HeadingBlock", "ParagraphBlock", "QuoteBlock", "ListBlock", "ButtonBlock", "DividerBlock", "SpacerBlock"],
  },
};
