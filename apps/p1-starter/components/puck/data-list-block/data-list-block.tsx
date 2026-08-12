"use client";

import { createDataListBlock } from "@pantheon-systems/puck-css/fields";
import { blockPaddingClass } from "../block-padding";

export const dataListBlock = createDataListBlock({
  wrapperClassName: blockPaddingClass,
});
