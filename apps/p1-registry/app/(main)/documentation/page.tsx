import { ExternalLink } from 'lucide-react';
import { DOCS_URL } from '../../../constants/links';

export const metadata = {
  title: 'Documentation — P1 Block Library',
};

export default function DocumentationPage() {
  return (
    <div className="p1-page p1-docs">
      <h1>A short introduction</h1>
      <div className="p1-docs__body">
        <p>
          Pantheon P1 is an AI-ready Website Management Platform built for all website
          builders who want to get more from their websites. Built for organizations of
          medium and large sizes, it is the first platform offering a coordinated workflow
          for the whole web team, providing all the tools developers, content creators and
          agents need to build an effective web presence.
        </p>
        <h2>The P1 Block Library</h2>
        <p>
          The P1 block library provides content creators with a catalog of pre-built,
          design-system-compliant React components that can be added to any page in the
          visual editor. These blocks are built for Next.js and P1, maintained by our
          development team. They offer a starting point for site builders without having
          to build all components from scratch.
        </p>
        <p>
          Your organization can use them as is or simply use them as a base and fork them
          in a different repository. You could also build your own component library for
          your organization following the same architecture. The value for the users and
          business: a simple way to enforce and control your organization&rsquo;s brand and
          layout standards across your fleet of websites.
        </p>
      </div>

      <div className="p1-docs__cta">
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="p1-btn p1-btn--brand"
        >
          More documentation
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
