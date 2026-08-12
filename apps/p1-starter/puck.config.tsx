import type { Config } from "@puckeditor/core";

import { buttonBlock } from "./components/puck/button-block";
import { dividerBlock } from "./components/puck/divider-block";
import { headingBlock } from "./components/puck/heading-block";
import { imageBlock } from "./components/puck/image-block";
import { gridBlock } from "./components/puck/grid-block";
import { listBlock } from "./components/puck/list-block";
import { mediaFigureBlock } from "./components/puck/media-figure-block";
import { paragraphBlock } from "./components/puck/paragraph-block";
import { quoteBlock } from "./components/puck/quote-block";
import { puckRoot } from "./components/puck/root";
import { spacerBlock } from "./components/puck/spacer-block";
import { welcomeBlock } from "./components/puck/welcome-block";
import { dataListBlock } from "./components/puck/data-list-block";

export const config = {
  categories: {
    typography: {
      title: "Typography",
      components: ["HeadingBlock", "ParagraphBlock", "QuoteBlock", "ListBlock"],
    },
    media: {
      title: "Media",
      components: ["ImageBlock", "MediaFigureBlock"],
    },
    data: {
      title: "Data",
      components: ["GridBlock", "DataListBlock"],
    },
    layout: {
      title: "Layout",
      components: ["DividerBlock", "SpacerBlock"],
    },
    actions: {
      title: "Actions",
      components: ["ButtonBlock"],
    },
    pages: {
      title: "Page Sections",
      components: ["P1WelcomeBlock"],
    },
  },
  root: puckRoot,
  components: {
    HeadingBlock: headingBlock,
    ParagraphBlock: paragraphBlock,
    ImageBlock: imageBlock,
    MediaFigureBlock: mediaFigureBlock,
    GridBlock: gridBlock,
    QuoteBlock: quoteBlock,
    ListBlock: listBlock,
    DividerBlock: dividerBlock,
    SpacerBlock: spacerBlock,
    ButtonBlock: buttonBlock,
    DataListBlock: dataListBlock,
    P1WelcomeBlock: welcomeBlock,
  },
} as Config;

export default config;
