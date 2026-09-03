/**
 * The home page's state before any content exists — a freshly scaffolded site,
 * or one with no backend configured yet.
 */

import { WelcomeBlockRender } from "../components/puck/welcome-block-render";

export function WelcomeBlock() {
  return (
    <WelcomeBlockRender
      heading="Welcome to your new Pantheon P1 Site."
      description="You just created this new site from Pantheon P1 starter kit, congrats! You'll need a Pantheon P1 user account to edit it and create new pages."
      ctaLabel="Sign-in to P1"
      ctaHref="/p1"
      footnote="Visit [P1 documentation](https://docs.pantheon.io) for more information."
      loggedInHeading="Welcome to your new Pantheon P1 Site."
      loggedInDescription="You just created this new site from Pantheon P1 starter kit, congrats! Start editing this page or visit the P1 dashboard to manage your site."
      loggedInCtaLabel="Edit this page with P1 Visual Editor"
      loggedInCtaHref="/p1"
      loggedInSecondaryLabel="Go to P1 Dashboard"
      loggedInFootnote="Visit [P1 documentation](https://docs.pantheon.io) for more information."
      showLogo={true}
    />
  );
}
