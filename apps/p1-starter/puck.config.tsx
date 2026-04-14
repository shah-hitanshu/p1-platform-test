import type { Config } from "@puckeditor/core";

import { buttonBlock } from "./components/puck/button-block";
import { dividerBlock } from "./components/puck/divider-block";
import { headingBlock } from "./components/puck/heading-block";
import { imageBlock } from "./components/puck/image-block";
import { gridBlock } from "./components/puck/grid-block";
import { listBlock } from "./components/puck/list-block";
import { paragraphBlock } from "./components/puck/paragraph-block";
import { quoteBlock } from "./components/puck/quote-block";
import { puckRoot } from "./components/puck/root";
import { spacerBlock } from "./components/puck/spacer-block";

export const config = {
  categories: {
    typography: {
      title: "Typography",
      components: ["HeadingBlock", "ParagraphBlock", "QuoteBlock", "ListBlock"],
    },
    media: {
      title: "Media",
      components: ["ImageBlock"],
    },
    data: {
      title: "Data",
      components: ["GridBlock"],
    },
    layout: {
      title: "Layout",
      components: ["DividerBlock", "SpacerBlock"],
    },
    actions: {
      title: "Actions",
      components: ["ButtonBlock"],
    },
  },
  root: puckRoot,
  components: {
    HeadingBlock: headingBlock,
    ParagraphBlock: paragraphBlock,
    ImageBlock: imageBlock,
    GridBlock: gridBlock,
    QuoteBlock: quoteBlock,
    ListBlock: listBlock,
    DividerBlock: dividerBlock,
    SpacerBlock: spacerBlock,
    ButtonBlock: buttonBlock,
  },
} as Config;

export default config;
