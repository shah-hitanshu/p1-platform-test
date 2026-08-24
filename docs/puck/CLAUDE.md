# Code development guidelines
When creating code, you MUST follow these guidelines:

1. Divide components of the architecture into logical segments driven by the architectural design.

2. Create an overall plan that you review with me for approval on each section of development before proceeding with any code creation.

3. Work on one component at a time from this approved plan, following the test-first cycle in the `testing` skill. YOU MUST NOT modify any tests without my explicit permission. Use subagents to write code appropriately following the guidance of the architectural documentation and any additional context I have provided.

4. As each component is finished and tests pass, proceed to the next component with my permission and follow the instructions in section 3 above to develop the application.

5. Ensure that you're designing systems in such a way that they interface with the infrastructure we have defined in the README.md file. 

# Styling (packages/puck-css)

- New component, new class → CSS Module beside the component. Do not convert existing
  global class names to modules; consumers theme against names like
  `p1-inspector-fields`, and hashing them breaks those overrides silently. Rules
  targeting Puck- or PDS-owned elements cannot be modules at all — the hashed selector
  would match nothing.
- Style Puck through its `overrides` API (`fieldTypes`, `fieldLabel`, `fields`,
  `drawer`, …) before reaching into its DOM. An override is a supported contract; a CSS
  hook into Puck's internals is not, and it fails silently on upgrade. If no override
  covers it, match the readable part of the class (`[class*="_NavItem-linkIcon_"]`) and
  never the generated hash, and comment why.
- Do not append to `src/styles.css`. When you touch an area, move it to a `.css` file
  beside its component and `@import` it from `styles.css` — as a pure move, in its own
  commit, so a cascade regression can't hide inside a reorganisation diff. `files`
  globs `src/**/*.css`, so nothing else is needed to publish it.

# Build after changes
Always run `pnpm build` after making code changes and verify a clean build (no errors) before reporting work as complete.

# Ask me for help and do not expand scope without permission
Do not expand the scope of the architecture. If you see gaps or opportunities as we develop, prepare a reasoned summary for my review before proceeding. 


# Playwright Browser Configuration
When opening a Playwright browser, always use the "Manage Tabs" mode to ensure proper tab management and control. Assume there's no open tabs already.

# Security Review
After each phase of development run Claude's /security-review and present findings. Auto-resolve what you are able to.

If findings from the security review are remediated, be sure to commit the changes after review.

# Tracking progress
 When you finish a phase of development, update the PROGRESS.md file with what you've done, what remains, and any decisions that were made by me along the way that may have shifted the architecture or implementation

# User interface language review
Use the Pantheon Design System UI Writing skill to review major pieces of work progress.

# Creating a Pull Request
- When creating a PR, use `.github/pull_request_template.md` as the description structure — follow its HTML-comment instructions and delete sections marked optional that don't apply; never invent your own headings.