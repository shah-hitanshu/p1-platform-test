# What we are doing
We are developing a complex system which is based on architectural documentation provided in collaborative-state-system-architecture-v2.3.md

This service may provide the backend to a number of applications. The initial focus will be on providing a JSON backend to a [Puck Editor](https://puckeditor.com) interface which we will develop in a later stage. You may use Puck Editor's documentation for reference, but do not yet develop new code for the front-end. We will do that in a separate project.

# Code development guidelines
When creating code, you MUST follow these guidelines:

1. Divide components of the architecture into logical segments driven by the architectural design.

2. Create an overall plan that you review with me for approval on each section of development before proceeding with any code creation.

3. Work on one component at a time from this approved plan following a streamlined test-driven process:
    a. Write tests based on expected inputs and outputs, following established patterns from existing test files
    b. Verify tests fail (red state) - include test output in your implementation review
    c. Commit tests to the repository
    d. Create application code only within the component we have chosen for development. Use subagents to write code appropriately following the guidance of the architectural documentation and any additional context I have provided. YOU MUST NOT modify any tests without my explicit permission.
    e. Run linting (`pnpm lint`) and fix all issues to follow language standards
    f. Verify all tests now pass (green state)
    g. Present your complete work for review with:
        - Test commit hash
        - Test output summary (all passing)
        - Linting output (0 errors)
        - Implementation summary
    h. After I approve, commit the implementation to the repo and update PROGRESS.md

4. As each component is finished and tests pass, proceed to the next component with my permission and follow the instructions in section 3 above to develop the application.

5. Ensure that you're designing systems in such a way that they interface with the infrastructure we have defined in the README.md file. 

# Ask me for help and do not expand scope without permission
Do not expand the scope of the architecture. If you see gaps or opportunities as we develop, prepare a reasoned summary for my review before proceeding. 

# Testing practices at Pantheon
Pantheon uses Playwright as the standard framework for UI and E2E testing in Node/JavaScript codebases, delivered through the internal "Carbon Framework." For unit testing, Vitest (with @testing-library/react) is used for React-based projects, and Jest is also used in some E2E configurations [1][2].
UI/E2E Testing (Carbon Framework)
The Carbon Framework is Pantheon's standard for UI test automation, built upon:

Playwright - primary test automation library [1]
Allure - detailed test reporting
axe-core - accessibility testing
Google JavaScript StyleGuide - coding standards [1]

Tests are written as .spec.js files in the tests directory. The framework is available via the carbon-js-web-automation GitHub repo [1].
Unit Testing
For unit testing React-based projects, the standard is:

Vitest - test runner
@testing-library/react - for snapshot tests and component testing [2]

Key Guidelines

Follow the Google JavaScript StyleGuide
Use Visual Studio Code with ESLint extension
Emphasize reusability (DRY principle)
Maintain code to production standards [1]
[1] UI Test Automation with Carbon Framework - Feb 28, 2024
[2] PCC User Acceptance Testing site - Jan 16, 2026
[3] #cms-ecosystem-updates Slack - Nov 26, 2025

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

# Database Configuration
PostgreSQL runs in a Docker container. Always use `docker exec` to interact with it — do not attempt local `psql` commands.

- Container: `css-postgres`
- User: `cssuser`
- Database: `cssdb`
- Password: `csspass`

Example: `docker exec css-postgres psql -U cssuser -d cssdb -c "SELECT 1;"`