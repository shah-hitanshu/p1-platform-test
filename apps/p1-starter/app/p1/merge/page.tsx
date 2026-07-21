"use client";

import dynamic from "next/dynamic";

const MergeReviewClient = dynamic(
  () => import("./merge-client").then((m) => ({ default: m.MergeReviewClient })),
  { ssr: false },
);

export default function MergeReviewPage() {
  return <MergeReviewClient />;
}
