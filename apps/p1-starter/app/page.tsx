/**
 * Home route. The pipeline lives in the SDK — see createPublishedPage in
 * app/published-pages.tsx for what this route is made of.
 */

import { published } from "./published-pages";

/**
 * Backstop only: publishing calls revalidatePath("/"), so the home page
 * normally refreshes the moment its content changes. This bounds how long an
 * edit made outside that path can stay stale.
 *
 * Must stay a literal here: Next.js statically analyzes segment-config exports,
 * so a value re-exported from the factory would go undetected.
 */
export const revalidate = 300;

export const generateMetadata = published.generateHomeMetadata;
export default published.HomePage;
