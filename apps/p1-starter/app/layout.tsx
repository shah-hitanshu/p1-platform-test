import "./styles.css";
import type { Metadata } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

// A page-level openGraph replaces (not merges) this one, so buildPageMetadata
// re-declares og:type and the env site-name fallback; this covers routes that
// return no openGraph (e.g. not-found early returns).
export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  openGraph: {
    type: "website",
    siteName: process.env.NEXT_PUBLIC_SITE_NAME,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* Puck's canvas-preview iframe copies this document's <body> attributes
          onto its own iframe <body> (@puckeditor/core's CopyHostStyles
          syncAttributes()), so a class/attribute placed directly on <body>
          cannot be used to keep a rule out of the iframe. `.p1-app-shell` is
          a child of <body> instead — Puck's canvas iframe never contains it
          (the iframe only ever renders the Puck root/block tree into its own
          #frame-root, not this layout). See styles.css for the scoped reset
          this enables. */}
      <body data-rm-theme="light">
        <div className="p1-app-shell">{children}</div>
      </body>
    </html>
  );
}
