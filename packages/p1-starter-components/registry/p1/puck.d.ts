/**
 * Augments Puck's BaseField with an `ai` metadata bag used by blocks to
 * declare AI-authoring instructions and exclusions. The Puck package itself
 * does not declare this property; it is passed through as opaque metadata.
 */
import "@puckeditor/core";

declare module "@puckeditor/core" {
  interface BaseField {
    ai?: {
      instructions?: string;
      exclude?: boolean;
    };
  }
}
