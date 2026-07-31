import { WelcomeBlockRender } from "./welcome-block-render";

export const welcomeBlock = {
  label: "P1 Welcome",
  fields: {
    heading: { type: "text" as const, label: "Heading (signed out)" },
    description: { type: "textarea" as const, label: "Description (signed out)" },
    ctaLabel: { type: "text" as const, label: "Primary button label (signed out)" },
    ctaHref: { type: "text" as const, label: "Primary button link (signed out)" },
    footnote: { type: "textarea" as const, label: "Footnote (signed out)" },
    loggedInHeading: { type: "text" as const, label: "Heading (signed in)" },
    loggedInDescription: { type: "textarea" as const, label: "Description (signed in)" },
    loggedInCtaLabel: { type: "text" as const, label: "Primary button label (signed in)" },
    loggedInCtaHref: { type: "text" as const, label: "Primary button link (signed in)" },
    loggedInSecondaryLabel: { type: "text" as const, label: "Secondary button label (signed in)" },
    loggedInFootnote: { type: "textarea" as const, label: "Footnote (signed in)" },
    showLogo: {
      type: "radio" as const,
      label: "Show P1 logo",
      options: [
        { label: "Yes", value: true },
        { label: "No", value: false },
      ],
    },
  },
  defaultProps: {
    heading: "Welcome to your new Pantheon P1 Site.",
    description:
      "You just created this new site from Pantheon P1 starter kit, congrats! You'll need a Pantheon P1 user account to edit it and create new pages.",
    ctaLabel: "Sign-in to P1",
    ctaHref: "/p1",
    footnote:
      "Visit [P1 documentation](https://docs.pantheon.io) for more information.",
    loggedInHeading: "Welcome to your new Pantheon P1 Site.",
    loggedInDescription:
      "You just created this new site from Pantheon P1 starter kit, congrats! Start editing this page or visit the P1 dashboard to manage your site.",
    loggedInCtaLabel: "Edit this page with P1 Visual Editor",
    loggedInCtaHref: "/p1",
    loggedInSecondaryLabel: "Go to P1 Dashboard",
    loggedInFootnote:
      "Visit [P1 documentation](https://docs.pantheon.io) for more information.",
    showLogo: true,
  },
  render: WelcomeBlockRender,
};
