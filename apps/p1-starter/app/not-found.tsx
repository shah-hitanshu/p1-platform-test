/**
 * Rendered by notFound() when a path has no published page. Being a real 404
 * rather than a 200 is what keeps crawler traffic from filling the response
 * cache with "doesn't exist yet" pages and getting them indexed.
 */

import { PageMissing } from "../components/page-missing";

export default function NotFound() {
  return <PageMissing />;
}
