# What we are doing
We are developing a complex system which is based on architectural documentation provided in ccr-architecture-v2.4.md

This service may provide the backend to a number of applications. The initial focus will be on providing a JSON backend to a [Puck Editor](https://puckeditor.com) interface which we will develop in a later stage. You may use Puck Editor's documentation for reference, but do not yet develop new code for the front-end. We will do that in a separate project.

# Code development guidelines
When creating code, you MUST follow these guidelines:

1. Divide components of the architecture into logical segments driven by the architectural design.

2. Create an overall plan that you review with me for approval on each section of development before proceeding with any code creation.

3. Work on one component at a time from this approved plan, following the test-first cycle in the `testing` skill. YOU MUST NOT modify any tests without my explicit permission. Use subagents to write code appropriately following the guidance of the architectural documentation and any additional context I have provided.

4. As each component is finished and tests pass, proceed to the next component with my permission and follow the instructions in section 3 above to develop the application.

5. Ensure that you're designing systems in such a way that they interface with the infrastructure we have defined in the README.md file. 

# Never import from @cloudflare/workers-types
In `workers/`, never write `import ... from '@cloudflare/workers-types'`. The package ships no `types`/`exports` entry, so the import resolves to its 15k-line `index.ts` source — a duplicate copy of the entire Workers type universe that tsserver/tsc must structurally compare against the ambient globals, hanging type checking for minutes. The types (`DurableObjectState`, `ExecutionContext`, `KVNamespace`, etc.) are already ambient globals via the tsconfig `types` array — use them directly without importing. An ESLint `no-restricted-imports` rule enforces this. (Importing from `cloudflare:workers`, e.g. `DurableObject`, is fine.)

# Ask me for help and do not expand scope without permission
Do not expand the scope of the architecture. If you see gaps or opportunities as we develop, prepare a reasoned summary for my review before proceeding. 


# Playwright Browser Configuration
When opening a Playwright browser, always use the "Manage Tabs" mode to ensure proper tab management and control. Assume there's no open tabs already.

When launching a browser, use new tabs rather than new windows — new windows will likely fail. After launch, dismiss the profile selection window before proceeding with any interactions.

# Security Review
After each phase of development run Claude's /security-review and present findings. Auto-resolve what you are able to.

If findings from the security review are remediated, be sure to commit the changes after review.

# Tracking progress
 When you finish a phase of development, update the PROGRESS.md file with what you've done, what remains, and any decisions that were made by me along the way that may have shifted the architecture or implementation

# User interface language review
Use the Pantheon Design System UI Writing skill to review major pieces of work progress.

# Data backfills
One-off data conversions are scripts, not migrations, and run from the **Run Backfill**
GitHub Action — dry run first, `execute` second. Before writing or running one, read
`docs/BACKFILLS.md`: it covers the two-file shape, the `db:<name>`/`db:<name>:execute`
pair the workflow depends on, how to register a new one, and the non-negotiables
(dry-run default, idempotent, append new versions rather than rewriting rows, latest
version only, report skip reasons).
