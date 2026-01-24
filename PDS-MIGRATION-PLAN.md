# PDS Migration Plan

## Overview

This document outlines the plan to migrate the collaborative-state-system frontend from custom CSS/components to the Pantheon Design System (PDS) React toolkit.

**Current State:** Custom components with bespoke CSS (~250+ custom classes)
**Target State:** PDS components with design tokens
**Package:** `@pantheon-systems/pds-toolkit-react` (v1.3.1 currently, v24.1.1 installed but unused)

---

## Phase 1: Foundation Setup

### 1.1 Update Dependencies
- Update `@pantheon-systems/pds-toolkit-react` to latest version
- Add `@pantheon-systems/pds-core` for base styles
- Add `@pantheon-systems/pds-icons` for icon support

### 1.2 Configure Global Styles
- Import `pds-core.css` at application root (`main.tsx`)
- Remove conflicting global styles from `index.css`
- Set up CSS custom properties for any necessary overrides

### 1.3 Set Up Layout Structure
Replace custom Layout component with PDS layouts:

| Current | PDS Replacement |
|---------|-----------------|
| Custom `.layout` flex container | `AppLayout` or `SidebarLayout` |
| Custom `.sidebar` | `SideNav` or `SideNavGlobal` |
| Custom navigation links | `SideNavGlobalItem` / navigation items |
| Custom user panel | `UserMenu` |

**Files affected:** `Layout.tsx`, `Layout.css`

---

## Phase 2: Core UI Components

### 2.1 Buttons (Priority: High)
Replace all custom button styles with PDS Button variants.

| Current Custom Class | PDS Component | Props |
|---------------------|---------------|-------|
| `.create-btn` (blue) | `Button` | `variant="primary"` |
| `.submit-btn` (green) | `Button` | `variant="primary"` |
| `.cancel-btn` (gray) | `Button` | `variant="secondary"` |
| `.delete-btn` / `.delete-link` (red) | `Button` | `variant="danger"` |
| `.refresh-btn` | `Button` | `variant="secondary"` or `IconButton` |
| `.logout-btn` | `Button` | `variant="secondary"` |
| `.view-link` | `ButtonLink` | `variant="secondary"` |
| `.action-btn` variants | `Button` | Various variants |

**Files affected:** All pages and `ConfirmDeleteModal.tsx`

### 2.2 Form Inputs (Priority: High)
Replace custom form elements with PDS input components.

| Current | PDS Replacement |
|---------|-----------------|
| `.form-input` | `TextInput` |
| `.form-select` | `Select` |
| `.form-textarea` | `Textarea` |
| `.form-label` | Built into PDS input `label` prop |
| `.form-group` | `InputGroup` or native PDS spacing |
| `.confirm-input` | `TextInput` |

**Files affected:**
- `LoginPage.tsx`
- `SitesPage.tsx`
- `SiteDetailPage.tsx`
- `BranchDetailPage.tsx`
- `CreateMergeRequestPage.tsx`
- `DocumentPage.tsx` (JSON editor)
- `ConfirmDeleteModal.tsx`
- `ConflictResolutionPanel.tsx` (radio buttons)

### 2.3 Modal (Priority: High)
Replace custom modal with PDS Modal.

| Current | PDS Modal Props |
|---------|-----------------|
| `.modal-overlay` | Built-in overlay |
| `.modal-content` | Modal container |
| `.modal-header` / `.modal-title` | `title` prop |
| `.modal-close` | `hasCloseButton` prop |
| `.modal-body` | Children |
| `.modal-actions` | Footer slot |

**PDS Modal Features:**
- `modalIsOpen` / `setModalIsOpen` for state
- `size` prop: `'sm' | 'md' | 'lg' | 'xl'`
- `disableOutsideClick` for confirmation dialogs
- Footer slot for action buttons

**Files affected:** `ConfirmDeleteModal.tsx`

---

## Phase 3: Data Display Components

### 3.1 Tables (Priority: High)
Replace custom table styles with PDS Table.

**Current tables:**
- Sites table (`SitesPage.tsx`)
- Branches table (`SiteDetailPage.tsx`)
- Checkpoints/Documents tables (`BranchDetailPage.tsx`)
- Version history table (`DocumentPage.tsx`)
- Merge requests table (`MergeRequestsPage.tsx`)
- Conflict list table (`ConflictList.tsx`)

**PDS Table provides:**
- Consistent styling
- Responsive behavior
- Sortable columns (optional)
- Row hover states

### 3.2 Badges & Status Indicators (Priority: High)
Replace custom badges with PDS badge components.

| Current Badge Type | PDS Component |
|-------------------|---------------|
| `.status-badge` (active/merged/archived/etc.) | `StatusBadge` |
| `.role-badge` | `StatusBadge` or `Tag` |
| `.type-badge` (manual/auto/merge) | `StatusBadge` |
| `.source-badge` (edit/merge/revert) | `StatusBadge` |
| `.conflict-type-badge` | `StatusBadge` |
| Conflict counts | `Tally` or `IndicatorBadge` |

**PDS StatusBadge variants:** `success`, `warning`, `danger`, `info`, `neutral`

### 3.3 Cards (Priority: Medium)
Replace custom card patterns with PDS Card.

| Current | PDS Replacement |
|---------|-----------------|
| `.dashboard-card` | `Card` with `CardHeading` |
| `.login-card` | `Card` |
| Empty state cards | `EmptyStateCard` or empty state components |
| `.create-form-container` | `Card` or `Panel` |

---

## Phase 4: Navigation Components

### 4.1 Breadcrumbs (Priority: High)
Replace custom breadcrumb with PDS Breadcrumb.

**Current:** Custom `.breadcrumb` with manual separators
**PDS:** `Breadcrumb` component with `items` array

**Files affected:** All detail pages

### 4.2 Tabs (Priority: High)
Replace custom tab navigation with PDS Tabs or TabMenu.

| Current | PDS Replacement |
|---------|-----------------|
| `.tabs-container` / `.tabs` | `Tabs` or `TabMenu` |
| `.tab` / `.tab.active` | Tab items |
| `.filter-tabs` / `.filter-tab` | `ButtonNav` or `TabMenu` |

**Files affected:**
- `BranchDetailPage.tsx` (Checkpoints/Documents tabs)
- `DocumentPage.tsx` (Content/Version History tabs)
- `MergeRequestsPage.tsx` (status filter tabs)

### 4.3 Sidebar Navigation
Replace custom sidebar with PDS navigation.

| Current | PDS Replacement |
|---------|-----------------|
| `.sidebar` | `SideNavGlobal` or `SideNav` |
| `.nav-list` / `.nav-link` | Navigation items |
| Active link highlighting | Built-in active states |

---

## Phase 5: Feedback & Notifications

### 5.1 Loading States (Priority: Medium)
Replace custom spinners with PDS loading components.

| Current | PDS Replacement |
|---------|-----------------|
| `.loading-spinner` (keyframes) | `Spinner` |
| Loading text | `Spinner` with label |
| Skeleton loading (if needed) | `Skeleton` |

### 5.2 Notifications & Messages (Priority: Medium)
Replace custom message displays with PDS notifications.

| Current | PDS Replacement |
|---------|-----------------|
| `.warning-banner` | `SectionMessage` or `Banner` with `variant="warning"` |
| `.notice-banner` | `InlineMessage` or `SectionMessage` |
| `.login-error` / `.create-error` | `InlineMessage` with `variant="danger"` |
| `.action-error` | `InlineMessage` |
| `.conflicts-warning` | `SectionMessage` with `variant="warning"` |
| Toast notifications (future) | `Toaster` + `useToast` |

### 5.3 Empty States (Priority: Medium)
Replace custom empty states with PDS empty state components.

| Current | PDS Replacement |
|---------|-----------------|
| `.empty-state` cards | `VerticalEmptyState` or `HorizontalEmptyState` |
| Empty table messages | `CompactEmptyState` |

---

## Phase 6: Specialized Components

### 6.1 Code Display (Priority: Low)
Evaluate PDS options for code/JSON display.

| Current | PDS Option |
|---------|------------|
| `JsonViewer` | `CodeBlock` (if suitable) or keep custom |
| `.json-content` | May need custom styling on top of PDS |

### 6.2 Conflict Resolution Panel (Priority: Medium)
May remain largely custom due to specialized functionality, but can use:
- PDS `RadioGroup` for resolution options
- PDS `Button` for actions
- PDS `Card` or `Panel` for container
- PDS `SectionMessage` for warnings

### 6.3 Merge Preview Panel (Priority: Medium)
Can leverage:
- PDS `Panel` for container
- PDS `Spinner` for loading
- PDS `InlineMessage` for errors
- PDS `StatusBadge` for merge status

---

## Migration Order & Dependencies

```
Phase 1: Foundation (blocks everything)
    ↓
Phase 2: Core UI (buttons, inputs, modal)
    ├── Update E2E tests for login, forms, modals
    ↓
Phase 3: Data Display (tables, badges, cards)
    ├── Update E2E tests for tables, badges
    ↓
Phase 4: Navigation (breadcrumbs, tabs, sidebar)
    ├── Update E2E tests for navigation
    ↓
Phase 5: Feedback (loading, notifications, empty states)
    ├── Update E2E tests for alerts, messages
    ↓
Phase 6: Specialized (code display, custom panels)
    ├── Update remaining E2E tests
    ↓
Phase 7: E2E Test Finalization
    └── Verify all tests pass, remove deprecated selectors
```

**Note:** E2E test updates happen incrementally with each phase, not as a separate final phase. Phase 7 is for final cleanup and verification.

---

## File-by-File Migration Checklist

### Components
- [ ] `Layout.tsx` - SideNavGlobal, UserMenu, AppLayout
- [ ] `Layout.css` - Remove (replaced by PDS)
- [ ] `ConfirmDeleteModal.tsx` - Modal, Button, TextInput, InlineMessage
- [ ] `ConfirmDeleteModal.css` - Remove
- [ ] `ApiResponse.tsx` - Spinner, InlineMessage
- [ ] `ApiResponse.css` - Remove
- [ ] `JsonViewer.tsx` - Evaluate CodeBlock or keep
- [ ] `JsonViewer.css` - Partial removal
- [ ] `ConflictList.tsx` - Table, StatusBadge, Tally
- [ ] `ConflictList.css` - Remove
- [ ] `ConflictResolutionPanel.tsx` - Panel, RadioGroup, Button, SectionMessage
- [ ] `ConflictResolutionPanel.css` - Remove
- [ ] `MergePreviewPanel.tsx` - Panel, Spinner, InlineMessage, StatusBadge
- [ ] `MergePreviewPanel.css` - Remove

### Pages
- [ ] `LoginPage.tsx` - Card, Select, Button, InlineMessage
- [ ] `LoginPage.css` - Remove
- [ ] `DashboardPage.tsx` - Card, CardHeading, Button, StatusBadge
- [ ] `DashboardPage.css` - Remove
- [ ] `SitesPage.tsx` - Card, Table, Button, TextInput, Modal
- [ ] `SitesPage.css` - Remove
- [ ] `SiteDetailPage.tsx` - Breadcrumb, Table, Button, TextInput, Select, StatusBadge
- [ ] `SiteDetailPage.css` - Remove
- [ ] `BranchDetailPage.tsx` - Breadcrumb, Tabs, Table, Button, TextInput, StatusBadge
- [ ] `BranchDetailPage.css` - Remove
- [ ] `DocumentPage.tsx` - Breadcrumb, Tabs, Button, Textarea, StatusBadge, Table
- [ ] `DocumentPage.css` - Remove
- [ ] `MergeRequestsPage.tsx` - Breadcrumb, TabMenu/ButtonNav, Table, StatusBadge
- [ ] `MergeRequestsPage.css` - Remove
- [ ] `MergeRequestDetailPage.tsx` - Breadcrumb, Button, StatusBadge, SectionMessage
- [ ] `MergeRequestDetailPage.css` - Remove
- [ ] `CreateMergeRequestPage.tsx` - Breadcrumb, Select, TextInput, Textarea, Button
- [ ] `CreateMergeRequestPage.css` - Remove

### Global
- [ ] `index.css` - Reduce to minimal overrides
- [ ] `main.tsx` - Import pds-core.css

### E2E Tests
- [ ] `login.spec.ts` - Update 7 class selectors to role-based/testid
- [ ] `site-crud.spec.ts` - Update 18+ selectors, update helper functions
- [ ] `branch-crud.spec.ts` - Update form, table, modal selectors
- [ ] `sites.spec.ts` - Update table and navigation selectors
- [ ] `dashboard.spec.ts` - Update card and navigation selectors
- [ ] `merge-requests.spec.ts` - Update table, badge, button selectors
- [ ] `branch-isolation.spec.ts` - Update mixed selectors

---

## Estimated Scope

| Phase | Components/Pages | E2E Tests Affected | Complexity |
|-------|-----------------|-------------------|------------|
| Phase 1 | 2 files | None | Low |
| Phase 2 | 10+ components across all pages | login.spec.ts, site-crud.spec.ts, branch-crud.spec.ts | High |
| Phase 3 | 8 tables, many badges | sites.spec.ts, merge-requests.spec.ts | Medium |
| Phase 4 | 7 pages with nav components | All tests (navigation selectors) | Medium |
| Phase 5 | Scattered across codebase | Tests with alert/message assertions | Low |
| Phase 6 | 3-4 specialized components | branch-isolation.spec.ts | Medium |
| Phase 7 | E2E test finalization | All 7 test files | Low |

---

## Testing Strategy

1. **Visual Regression:** Compare before/after screenshots
2. **E2E Tests:** Update selectors as components are migrated (see Phase 7)
3. **Accessibility:** Leverage PDS built-in a11y features
4. **Component Tests:** Add unit tests for any custom wrapper components

---

## Phase 7: E2E Test Migration

PDS components use different DOM structures and class names than custom components. All E2E tests must be updated to use PDS-compatible selectors.

### 7.1 Current Selector Patterns in Use

The following CSS class selectors are used in E2E tests and will break after migration:

#### Login Tests (`login.spec.ts`)
| Current Selector | Used For | PDS Replacement Strategy |
|------------------|----------|--------------------------|
| `.login-title` | Page title | Use `getByRole('heading')` or add `data-testid` |
| `#user-select` | User dropdown | PDS `Select` - use `getByRole('combobox')` or `data-testid` |
| `.user-preview` | Preview section | Add `data-testid="user-preview"` |
| `.preview-value` | Preview values | Add `data-testid` attributes |
| `.login-button` | Submit button | PDS `Button` - use `getByRole('button', { name: 'Sign In' })` |
| `.user-name` | Sidebar user name | Add `data-testid="user-name"` |
| `.logout-btn` | Logout button | PDS `Button` - use `getByRole('button', { name: 'Logout' })` |

#### Site CRUD Tests (`site-crud.spec.ts`)
| Current Selector | Used For | PDS Replacement Strategy |
|------------------|----------|--------------------------|
| `.create-btn` | Create button | `getByRole('button', { name: 'Create Site' })` |
| `.form-input` | Text inputs | PDS `TextInput` - use `getByLabel()` or `data-testid` |
| `.submit-btn` | Submit button | `getByRole('button', { name: 'Create' })` |
| `.create-form` | Form container | Add `data-testid="create-form"` |
| `.sites-table` | Sites table | PDS `Table` - use `getByRole('table')` |
| `.nav-link` | Navigation links | PDS nav items - use `getByRole('link', { name })` |
| `.delete-link` | Delete button | `getByRole('button', { name: 'Delete' })` |
| `.view-link` | View button | `getByRole('link', { name: 'View' })` |
| `.modal-overlay` | Modal backdrop | PDS Modal - use `getByRole('dialog')` |
| `.modal-title` | Modal heading | `getByRole('heading')` within dialog |
| `.modal-content` | Modal container | `getByRole('dialog')` |
| `.delete-btn` | Confirm delete | `getByRole('button', { name: 'Delete' })` within dialog |
| `.confirm-input` | Confirmation input | `getByLabel()` or `getByPlaceholder()` |
| `.cancel-btn` | Cancel button | `getByRole('button', { name: 'Cancel' })` |
| `.modal-error` | Error message | PDS `InlineMessage` - use `getByRole('alert')` |
| `.site-title` | Site detail title | Add `data-testid="site-title"` or use heading role |
| `.branches-section` | Branches area | Add `data-testid="branches-section"` |
| `.archive-link` | Archive button | `getByRole('button', { name: 'Archive' })` |
| `.status-badge` | Status badges | PDS `StatusBadge` - use text content or `data-testid` |

#### Other Test Files
Similar patterns exist in:
- `branch-crud.spec.ts`
- `branch-isolation.spec.ts`
- `dashboard.spec.ts`
- `merge-requests.spec.ts`
- `sites.spec.ts`

### 7.2 Selector Migration Strategy

**Recommended approach:** Migrate to accessible role-based selectors where possible, add `data-testid` attributes for elements without clear accessible roles.

#### Priority 1: Role-Based Selectors (Preferred)
```typescript
// Before (fragile)
await page.click('.login-button');
await page.locator('.sites-table').toBeVisible();

// After (robust)
await page.getByRole('button', { name: 'Sign In' }).click();
await page.getByRole('table').toBeVisible();
```

PDS components have good accessibility, enabling role-based selection:
- Buttons → `getByRole('button', { name: '...' })`
- Links → `getByRole('link', { name: '...' })`
- Inputs → `getByLabel('...')` or `getByRole('textbox')`
- Selects → `getByRole('combobox')`
- Tables → `getByRole('table')`
- Modals → `getByRole('dialog')`
- Headings → `getByRole('heading', { name: '...' })`
- Alerts → `getByRole('alert')`

#### Priority 2: Data-TestId Attributes
For elements without clear accessible names, add `data-testid`:
```tsx
// Component
<div data-testid="user-preview" className="...">

// Test
await page.getByTestId('user-preview').toBeVisible();
```

### 7.3 Test File Migration Checklist

| Test File | Selectors to Update | Priority |
|-----------|---------------------|----------|
| `login.spec.ts` | 7 class selectors | High (Phase 2) |
| `site-crud.spec.ts` | 18+ class selectors | High (Phase 2-3) |
| `branch-crud.spec.ts` | Similar to site-crud | High (Phase 2-3) |
| `sites.spec.ts` | Table/navigation selectors | Medium (Phase 3-4) |
| `dashboard.spec.ts` | Card/navigation selectors | Medium (Phase 3-4) |
| `merge-requests.spec.ts` | Table/badge/button selectors | Medium (Phase 3-4) |
| `branch-isolation.spec.ts` | Mixed selectors | Low (Phase 6) |

### 7.4 Migration Process for Each Phase

For each component migration phase:

1. **Before changing component:**
   - Identify all E2E tests using that component
   - Document current selectors

2. **While changing component:**
   - Add `data-testid` attributes where needed
   - Ensure accessible names are set for PDS components

3. **After changing component:**
   - Update test selectors to use role-based or data-testid selectors
   - Run tests to verify they pass
   - Commit component + test changes together

### 7.5 Example: Login Page Test Migration

**Before (current):**
```typescript
test('should login and redirect to dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.selectOption('#user-select', ALICE_USER_ID);
  await page.click('.login-button');
  await expect(page).toHaveURL('/');
  await expect(page.locator('.user-name')).toContainText('Alice Developer');
});
```

**After (with PDS):**
```typescript
test('should login and redirect to dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('combobox', { name: 'Select User' }).selectOption(ALICE_USER_ID);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('user-name')).toContainText('Alice Developer');
});
```

### 7.6 Helper Function Updates

Update test helper functions that use class selectors:

**Before:**
```typescript
async function createSite(page, siteName, pantheonId) {
  await page.click('.create-btn');
  await page.locator('.form-input').first().fill(siteName);
  await page.locator('.form-input').nth(1).fill(pantheonId);
  await page.click('.submit-btn');
  await expect(page.locator('.create-form')).not.toBeVisible();
}
```

**After:**
```typescript
async function createSite(page, siteName, pantheonId) {
  await page.getByRole('button', { name: 'Create Site' }).click();
  await page.getByLabel('Site Name').fill(siteName);
  await page.getByLabel('Pantheon Site ID').fill(pantheonId);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('create-form')).not.toBeVisible();
}
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing E2E tests | Update selectors incrementally, use data-testid attributes |
| Style conflicts | Remove all custom CSS before applying PDS |
| Missing functionality | Document gaps, create wrapper components if needed |
| Design divergence | Follow PDS patterns, document intentional deviations |

---

## Success Criteria

1. All custom CSS files removed (except minimal overrides)
2. All components use PDS equivalents
3. All 7 E2E test files updated to use role-based or data-testid selectors
4. No remaining CSS class selectors in E2E tests (e.g., `.login-button`, `.form-input`)
5. All E2E tests pass
6. Consistent look and feel with Pantheon ecosystem
7. Improved accessibility via PDS built-in features

---

## Next Steps

1. **Review this plan** and approve phases
2. **Phase 1:** Set up foundation (pds-core.css, update deps)
3. **Start Phase 2:** Begin with Layout component as it affects all pages
4. **For each component migration:**
   - Update component to use PDS
   - Add `data-testid` attributes where needed
   - Update affected E2E tests
   - Verify tests pass before moving on
5. **Iterate:** Complete one phase at a time with E2E test verification between phases
6. **Phase 7:** Final E2E test audit to ensure all class selectors are removed
