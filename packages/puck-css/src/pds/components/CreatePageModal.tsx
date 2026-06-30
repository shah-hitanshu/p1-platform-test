/**
 * CreatePageModal
 *
 * The "Create a new page" modal, opened from the PageNavigator's "+ New page".
 * Single-screen design: pick a starting point, name the page (which derives the
 * URL slug), optionally open an Advanced panel, then "Create page".
 *
 * NOTE: This uses a lightweight custom modal shell (backdrop + panel) rather
 * than the PDS `Modal`. The PDS v2 `Modal` (through alpha.16) calls
 * `useOverlayContext()` on every render, which throws unless an
 * `OverlayContextProvider` is an ancestor — but that provider is not exported
 * from the package, making `Modal` unusable here. Interactive fields use native
 * inputs (the PDS TextInput/Textarea are not usable in this context either) and
 * are styled with PDS design tokens.
 *
 * Phase 1 scope:
 *   - Starting points: "Blank page" is active; "Content type template" and
 *     "Generate with AI" are disabled; "New page template" is admin-only and
 *     disabled. Later phases enable the rest.
 *   - Page title auto-derives the slug until the slug is edited manually.
 *   - Slug is sanitized (lowercase, no spaces, no special characters).
 *   - The Advanced panel is rendered as designed but fully disabled.
 *   - "Create page" creates the page via onCreateDocument(slug, title); the
 *     title is persisted into the new page's root.props.title (see useDocuments).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { WizardQuestion } from './WizardQuestion.js';
import styles from './CreatePageModal.module.css';

/** Step 1 of the Plug-external-data flow: where the data comes from. */
type DataSourceMode = '' | 'configured' | 'new';
/** Step 2: page structure — a collection (index + detail per item) or a single page. */
type PageStructure = '' | 'collection' | 'single';

/**
 * A content-type template as the modal consumes it. Intentionally a minimal,
 * local shape (not the feature's full `Template` type) to keep this PDS
 * component decoupled — the editor maps real templates into this on the way in.
 */
export interface CreatePageModalTemplate {
  id: string;
  /** Kebab identifier; shown when the template has no label. */
  name: string;
  label: string;
  description?: string;
  /** Route pattern whose `:params` become user-filled route inputs. */
  defaultUrlPattern?: string;
  version: number;
}

export interface CreatePageModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Called when the modal should close (close button, Cancel, backdrop, Escape, or success). */
  onClose: () => void;
  /**
   * Called with the new page path and the entered page title when the user
   * creates a page. When created from a content-type template, the template id
   * is passed so the page is scaffolded from it and bound to it. Should resolve
   * on success and reject with an Error whose message is shown on failure.
   */
  onCreateDocument: (path: string, title: string, templateId?: string) => Promise<void>;
  /**
   * Whether the current user is an administrator. Reserved for gating admin-only
   * options (e.g. "New page template") once permission checks are added — not
   * enforced yet; admin-only tiles are currently shown to everyone.
   */
  isAdmin?: boolean;
  /**
   * Host shown as the URL-slug prefix and in the full-path preview (e.g. "example.com").
   * TODO: source this from the site's domain once the css-client `Site` type / API
   * exposes it (it currently does not). For now it defaults to the current window host.
   */
  siteHost?: string;
  /**
   * Available data sources for the (exploratory) Dynamic route / collection builder
   * dropdown — both user-defined and built-in. `inputs` are the param names the
   * source expects (mocked for now); one input auto-generates the route param.
   */
  datasources?: { id: string; label: string; inputs?: string[] }[];
  /**
   * Real content-type templates from the backend. The modal has NO built-in/fake
   * list: when there are none (undefined or empty), the "Page type template"
   * section shows an empty message — a customer running P1 with zero templates
   * is a normal state. The "New template" action is always available.
   */
  templates?: CreatePageModalTemplate[];
  /**
   * Create a new template from the "New template" screen. Receives the kebab
   * `name`, `label`, and optional `description` / `defaultUrlPattern`. Should
   * resolve with the created template (its `name` is used to open its editor).
   */
  onCreateTemplate?: (params: {
    name: string;
    label: string;
    description?: string;
    defaultUrlPattern?: string;
  }) => Promise<{ name: string } | undefined>;
  /**
   * Navigate the editor to an existing page path (no creation). Used by the
   * collection recap's "Edit index page" / "Edit dynamic page" buttons.
   */
  onNavigate?: (path: string) => void;
  /**
   * Initial screen when the modal opens. `'new-template'` lands directly on the
   * New-template definition form (equivalent to choosing "From page template" →
   * "+ New template"). `'page'` (default) shows the starting-point grid.
   */
  initialMode?: 'page' | 'new-template';
}

interface StartingPoint {
  key: string;
  testId: string;
  label: string;
  description: string;
  enabled: boolean;
  adminOnly: boolean;
}

// Phase 1: only "blank" is enabled. The rest are placeholders for later phases.
const STARTING_POINTS: StartingPoint[] = [
  {
    key: 'blank',
    testId: 'create-page-option-blank',
    label: 'Blank page',
    description: 'Start with an empty canvas.',
    enabled: true,
    adminOnly: false,
  },
  {
    key: 'content-type-template',
    testId: 'create-page-option-content-type-template',
    label: 'From page template',
    description: 'Begin from a proven layout.',
    enabled: true,
    adminOnly: false,
  },
  {
    key: 'generate-ai',
    testId: 'create-page-option-generate-ai',
    label: 'Generate with AI',
    description: 'Describe it — AI drafts a first pass.',
    enabled: true,
    adminOnly: false,
  },
  {
    key: 'plug-external-data',
    testId: 'create-page-option-plug-external-data',
    label: 'Plug external data',
    description: 'Configure data sources and build pages from them.',
    enabled: true,
    adminOnly: false,
  },
];

// Inline icons (stroke = currentColor) so colors are driven by CSS and there's
// no dependency on PDS icon-name lookups.
const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

const OPTION_ICONS: Record<string, React.JSX.Element> = {
  blank: (
    <svg {...ICON_PROPS}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  'content-type-template': (
    <svg {...ICON_PROPS}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  ),
  'generate-ai': (
    <svg {...ICON_PROPS}>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
    </svg>
  ),
  'plug-external-data': (
    <svg {...ICON_PROPS}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" />
    </svg>
  ),
};

// A content type as rendered in the modal's "Choose a content type" grid.
// Derived from the real `templates` prop — there is no built-in/fake list.
interface ContentType {
  key: string;
  label: string;
  description: string;
  /** Route pattern; `:params` become user-filled route inputs. May be empty. */
  urlPattern: string;
}

/**
 * Validate a user-typed URL pattern for a new template. Rules: starts with `/`,
 * each segment is static (`a-z0-9-`) or a param (`:name`), at least one param, and
 * param names are unique. e.g. valid: "/blog/:year/:month/:slug" — invalid:
 * "/blog", "blog/:x", "/:Bad", "/recipe/:p/test/:p" (duplicate param).
 */
function isValidUrlPattern(pattern: string): boolean {
  if (!pattern.startsWith('/')) return false;
  const segments = pattern.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  const seenParams = new Set<string>();
  for (const seg of segments) {
    if (seg.startsWith(':')) {
      if (!/^:[a-z][a-z0-9]*$/.test(seg)) return false;
      const name = seg.slice(1);
      if (seenParams.has(name)) return false; // params must be unique
      seenParams.add(name);
    } else if (!/^[a-z0-9-]+$/.test(seg)) {
      return false;
    }
  }
  return seenParams.size > 0;
}

/** Return a validation message for a URL pattern, or null when it's valid/empty. */
function getUrlPatternError(pattern: string): string | null {
  if (pattern.trim() === '') return null;
  // Allowed characters only: lowercase letters, digits, '-', '/', ':'.
  if (/[^a-z0-9:/-]/.test(pattern)) {
    return 'Special characters, upper case and spaces are not welcome.';
  }
  if (!isValidUrlPattern(pattern)) {
    return 'Use “/static/:param” segments with at least one unique “:param”.';
  }
  return null;
}

/** Split a URL pattern into ordered segments (static text or `:param`). */
function parsePattern(pattern: string): { type: 'static' | 'param'; value: string }[] {
  return pattern
    .split('/')
    .filter(Boolean)
    .map((seg) =>
      seg.startsWith(':')
        ? { type: 'param' as const, value: seg.slice(1) }
        : { type: 'static' as const, value: seg },
    );
}

/** Resolve a value for a pattern param: `:slug` uses the slug, others use `params`. */
function patternParamValue(
  name: string,
  slug: string,
  params: Record<string, string>,
): string {
  return name === 'slug' ? slug : (params[name] ?? '');
}

/** Build the concrete path for a URL pattern (no leading slash), filling params. */
function buildPatternPath(
  pattern: string,
  slug: string,
  params: Record<string, string>,
): string {
  return parsePattern(pattern)
    .map((seg) =>
      seg.type === 'static' ? seg.value : patternParamValue(seg.value, slug, params),
    )
    .join('/');
}

/** Whether every `:param` in the pattern has a non-empty value. */
function patternParamsFilled(
  pattern: string,
  slug: string,
  params: Record<string, string>,
): boolean {
  return parsePattern(pattern)
    .filter((seg) => seg.type === 'param')
    .every((seg) => patternParamValue(seg.value, slug, params).trim().length > 0);
}

/** Derive a slug from a free-text title: lowercase, hyphenated, no special chars. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Sanitize a manually-typed slug: lowercase, spaces to hyphens, drop invalid chars. */
function sanitizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function CreatePageModal({
  open,
  onClose,
  onCreateDocument,
  siteHost,
  datasources = [],
  templates,
  onCreateTemplate,
  onNavigate,
  initialMode = 'page',
}: CreatePageModalProps): React.JSX.Element | null {
  const host =
    siteHost ?? (typeof window !== 'undefined' ? window.location.host : '');
  const [selected, setSelected] = useState('blank');
  const [contentType, setContentType] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  // "New template" definition form (mocked create; opens the template editor later).
  const [templateName, setTemplateName] = useState('');
  const [templateLabel, setTemplateLabel] = useState('');
  const [templateLabelEdited, setTemplateLabelEdited] = useState(false);
  const [templateDescription, setTemplateDescription] = useState('');
  const [templatePattern, setTemplatePattern] = useState('');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // "Plug external data" collection builder. Multi-select data sources; route
  // params are derived from the union of the selected sources' inputs (shared
  // name = join key). Sources can be added on the fly (mocked). The route is
  // /<slug>/:<derived params>.
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>('');
  const [pageStructure, setPageStructure] = useState<PageStructure>('');
  const [selectedDatasourceIds, setSelectedDatasourceIds] = useState<string[]>([]);
  const [customSources, setCustomSources] = useState<
    { id: string; label: string; inputs?: string[] }[]
  >([]);
  const [newType, setNewType] = useState('https-json');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  // After creating a collection, show a recap (index + dynamic page) instead of
  // navigating straight to a single page.
  const [recap, setRecap] = useState<{ indexPath: string; dynamicPath: string } | null>(
    null,
  );

  // Reset to a fresh state whenever the modal is closed.
  useEffect(() => {
    if (!open) {
      setSelected('blank');
      setContentType(null);
      setParams({});
      setTemplateName('');
      setTemplateLabel('');
      setTemplateLabelEdited(false);
      setTemplateDescription('');
      setTemplatePattern('');
      setDataSourceMode('');
      setPageStructure('');
      setSelectedDatasourceIds([]);
      setCustomSources([]);
      setNewType('https-json');
      setNewName('');
      setNewUrl('');
      setTitle('');
      setSlug('');
      setSlugEdited(false);
      setError(null);
      setSubmitting(false);
      setRecap(null);
    }
  }, [open]);

  // When opened in 'new-template' mode, jump straight to the New-template form
  // (same state as "From page template" → "+ New template").
  useEffect(() => {
    if (open && initialMode === 'new-template') {
      setSelected('content-type-template');
      setContentType('new-template');
    }
  }, [open, initialMode]);

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setTitle(next);
      // Keep the slug in sync with the title until the user overrides it.
      if (!slugEdited) setSlug(slugify(next));
    },
    [slugEdited],
  );

  const handleSlugChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSlug(sanitizeSlug(e.target.value));
    setSlugEdited(true);
  }, []);

  const handleTemplateNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setTemplateName(next);
      // Label mirrors Name until the user edits the Label.
      if (!templateLabelEdited) setTemplateLabel(next);
    },
    [templateLabelEdited],
  );

  const handleTemplateLabelChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTemplateLabel(e.target.value);
      setTemplateLabelEdited(true);
    },
    [],
  );

  const toggleSource = useCallback((id: string) => {
    setSelectedDatasourceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  // Mocked on-the-fly source creation. Inputs are derived from `:param` tokens
  // in the URL (the real version would persist + derive from the urlTemplate).
  const addCustomSource = useCallback(() => {
    const name = newName.trim();
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!id) return;
    const derived = [
      ...new Set(
        (newUrl.match(/:([a-z][a-z0-9]*)/gi) ?? []).map((t) => t.slice(1).toLowerCase()),
      ),
    ];
    // Every source needs at least one param to identify the record. If the URL
    // declares none, default to "<name>Id" so the route still has a key.
    const inputs = derived.length ? derived : [`${id.replace(/-/g, '')}Id`];
    setCustomSources((prev) =>
      prev.some((s) => s.id === id) ? prev : [...prev, { id, label: name, inputs }],
    );
    setSelectedDatasourceIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setNewName('');
    setNewUrl('');
  }, [newName, newUrl]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      // "New template" screen: create the template via the real API, then open
      // its editor (template mode at _registry/templates/<name>) and close.
      if (contentType === 'new-template') {
        const name = slugify(templateName);
        const label = templateLabel.trim();
        const pattern = templatePattern.trim();
        if (
          !onCreateTemplate ||
          submitting ||
          !name ||
          !label ||
          getUrlPatternError(templatePattern)
        ) {
          return;
        }
        setSubmitting(true);
        setError(null);
        try {
          const templateParams: {
            name: string;
            label: string;
            description?: string;
            defaultUrlPattern?: string;
          } = { name, label };
          if (templateDescription.trim())
            templateParams.description = templateDescription.trim();
          if (pattern) templateParams.defaultUrlPattern = pattern;
          const created = await onCreateTemplate(templateParams);
          const createdName =
            (created && 'name' in created ? created.name : undefined) ?? name;
          onNavigate?.(`_registry/templates/${createdName}`);
          onClose();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to create template');
          setSubmitting(false);
        }
        return;
      }

      const finalSlug = slug.trim();
      if (!finalSlug || submitting) return;

      // Plug external data. "Everything on one page" → a single page that lists
      // all items. "Index + detail" → an index page plus a dynamic per-item page
      // at /<slug>/:<params>, then a recap.
      if (selected === 'plug-external-data') {
        if (!pageStructure) return;
        setSubmitting(true);
        setError(null);
        try {
          if (pageStructure === 'single') {
            await onCreateDocument(finalSlug, title.trim());
            onNavigate?.(finalSlug);
            onClose();
            return;
          }
          const sources = [...datasources, ...customSources].filter((s) =>
            selectedDatasourceIds.includes(s.id),
          );
          const paramNames = [...new Set(sources.flatMap((s) => s.inputs ?? []))];
          // A collection needs a per-item param for its detail page; refuse to
          // create a paramless "collection" (the button is disabled for this too).
          if (paramNames.length === 0) {
            setSubmitting(false);
            return;
          }
          await onCreateDocument(finalSlug, title.trim());
          const dynamicPath = `/${finalSlug}${paramNames
            .map((p) => `/:${p}`)
            .join('')}`;
          await onCreateDocument(dynamicPath, title.trim());
          setSubmitting(false);
          setRecap({ indexPath: `/${finalSlug}`, dynamicPath });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to create pages');
          setSubmitting(false);
        }
        return;
      }

      // Content-type template: build the path from the template's URL pattern,
      // then create the page from that template — the chain scaffolds the
      // template's components and binds templateId/version.
      if (
        selected === 'content-type-template' &&
        contentType &&
        contentType !== 'new-template'
      ) {
        const ct = (templates ?? []).find((t) => t.id === contentType);
        const pattern = ct?.defaultUrlPattern ?? '';
        const filled = pattern
          ? patternParamsFilled(pattern, slug, params)
          : slug.trim().length > 0;
        if (!ct || submitting || !filled) return;
        const path = pattern ? buildPatternPath(pattern, slug, params) : slug.trim();
        setSubmitting(true);
        setError(null);
        try {
          await onCreateDocument(path, title.trim(), ct.id);
          onNavigate?.(path);
          onClose();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to create page');
          setSubmitting(false);
        }
        return;
      }

      // Blank-page path. (Other tiles are mocked / handled above.)
      if (selected !== 'blank') return;
      setSubmitting(true);
      setError(null);
      try {
        await onCreateDocument(finalSlug, title.trim());
        // Navigate to the new page, then close.
        onNavigate?.(finalSlug);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create page');
        setSubmitting(false);
      }
    },
    [
      contentType,
      templateName,
      templateLabel,
      templatePattern,
      templateDescription,
      onCreateTemplate,
      templates,
      params,
      selected,
      slug,
      title,
      submitting,
      pageStructure,
      datasources,
      customSources,
      selectedDatasourceIds,
      onNavigate,
      onCreateDocument,
      onClose,
    ],
  );

  const handleEditPage = useCallback(
    (path: string) => {
      onNavigate?.(path);
      onClose();
    },
    [onNavigate, onClose],
  );

  if (!open) return null;

  // TODO: gate `adminOnly` options behind the `isAdmin` prop once permission
  // checks exist. For now every option is shown to everyone.
  const visiblePoints = STARTING_POINTS;

  // Content types come from the real templates (no built-in/fake list). Keyed by
  // template id; the template's defaultUrlPattern drives the route inputs.
  const contentTypeList: ContentType[] = (templates ?? []).map((t) => ({
    key: t.id,
    label: t.label || t.name,
    description: t.description ?? '',
    urlPattern: t.defaultUrlPattern ?? '',
  }));

  // When a content type is chosen, its URL pattern drives the route inputs.
  const selectedCt =
    selected === 'content-type-template'
      ? (contentTypeList.find((c) => c.key === contentType) ?? null)
      : null;

  // The content-type flow can create once a type is picked and the route is
  // defined: a template with a URL pattern needs its `:param`s (incl. `:slug`)
  // filled; a template without a pattern needs a slug.
  const canCreateContentType =
    selectedCt !== null &&
    (selectedCt.urlPattern
      ? patternParamsFilled(selectedCt.urlPattern, slug, params)
      : slug.trim().length > 0);

  // "New template" is a distinct screen within the modal.
  const isTemplateScreen = contentType === 'new-template';
  const templatePatternError = getUrlPatternError(templatePattern);
  // "Create template" is enabled once Name + Label are set and the (optional)
  // URL pattern is valid.
  const canCreateTemplate =
    slugify(templateName).length > 0 &&
    templateLabel.trim().length > 0 &&
    !templatePatternError;

  // "Plug external data" — the collection builder (data sources → child pages).
  const isPlugExternalData = selected === 'plug-external-data';

  // Page title + URL (at the top) show for Blank or once a content type is
  // picked. The Plug-external-data flow asks for the title later — in its own
  // naming step after the data source + structure questions.
  const showPageFields = selected === 'blank' || selectedCt !== null;

  // Collection builder derived state.
  const availableSources = [...datasources, ...customSources];
  const selectedSources = availableSources.filter((s) =>
    selectedDatasourceIds.includes(s.id),
  );
  // Route params = union of the selected sources' inputs (shared name = join key).
  const routeParamNames = [
    ...new Set(selectedSources.flatMap((s) => s.inputs ?? [])),
  ];
  const collectionRoutePattern = `/${slug}${routeParamNames
    .map((p) => `/:${p}`)
    .join('')}`;

  // A collection's detail page needs a per-item route param. A list-only source
  // (e.g. swapi_list, no inputs) can't identify a single item, so "index +
  // detail" is invalid until a per-item source is added.
  const collectionNeedsParam =
    isPlugExternalData &&
    pageStructure === 'collection' &&
    selectedSources.length > 0 &&
    routeParamNames.length === 0;

  const content = (
    <div className={styles.backdrop} data-testid="create-page-modal" onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-page-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            +
          </span>
          <div className={styles.headerText}>
            <h2
              id="create-page-modal-title"
              data-testid="create-page-modal-title"
              className={styles.title}
            >
              {isTemplateScreen ? 'Create a page template' : 'Create a new page'}
            </h2>
            <p className={styles.subtitle}>
              {isTemplateScreen
                ? 'Initiate a new page template, then define the layout and components used by pages of that type.'
                : 'Pick a starting point, name it, and you’re editing.'}
            </p>
          </div>
          <button
            type="button"
            data-testid="create-page-modal-close"
            className={styles.closeButton}
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {!isTemplateScreen && (
          <fieldset className={styles.startFrom}>
            <legend className={styles.sectionLabel}>Start from</legend>
            <div className={styles.optionGrid}>
              {visiblePoints.map((point) => (
                <button
                  key={point.key}
                  type="button"
                  data-testid={point.testId}
                  className={`${styles.optionButton}${
                    selected === point.key ? ` ${styles.optionButtonSelected}` : ''
                  }`}
                  disabled={!point.enabled}
                  aria-pressed={selected === point.key}
                  onClick={() => point.enabled && setSelected(point.key)}
                >
                  <span className={styles.optionIcon}>{OPTION_ICONS[point.key]}</span>
                  <span className={styles.optionLabel}>{point.label}</span>
                  <span className={styles.optionDescription}>{point.description}</span>
                </button>
              ))}
            </div>
          </fieldset>
          )}

          {!isTemplateScreen && selected === 'content-type-template' && (
            <fieldset
              data-testid="create-page-content-types"
              className={styles.startFrom}
            >
              <legend className={styles.sectionLabel}>Choose a content type</legend>
              {contentTypeList.length === 0 && (
                <p
                  data-testid="create-page-content-types-empty"
                  className={styles.fieldHint}
                >
                  No Page type template configured.
                </p>
              )}
              <div className={styles.contentTypeGrid}>
                {contentTypeList.map((ct) => (
                  <button
                    key={ct.key}
                    type="button"
                    data-testid={`create-page-content-type-${ct.key}`}
                    className={`${styles.contentTypeCard}${
                      contentType === ct.key ? ` ${styles.contentTypeCardSelected}` : ''
                    }`}
                    aria-pressed={contentType === ct.key}
                    onClick={() => setContentType(ct.key)}
                  >
                    <span className={styles.contentTypeName}>{ct.label}</span>
                    <span className={styles.contentTypeDescription}>
                      {ct.description}
                    </span>
                  </button>
                ))}

                {/* "Create a new template" escape hatch. Mocked for now; should be
                    gated to admins once permission checks exist. */}
                <button
                  type="button"
                  data-testid="create-page-content-type-new-template"
                  className={`${styles.contentTypeCard} ${styles.contentTypeCardNew}${
                    contentType === 'new-template'
                      ? ` ${styles.contentTypeCardSelected}`
                      : ''
                  }`}
                  aria-pressed={contentType === 'new-template'}
                  onClick={() => setContentType('new-template')}
                >
                  <span className={styles.contentTypeName}>＋ New template</span>
                  <span className={styles.contentTypeDescription}>
                    Don’t see the right one? Create a new template.
                  </span>
                </button>
              </div>
            </fieldset>
          )}

          {contentType === 'new-template' ? (
            <>
            <button
              type="button"
              data-testid="create-template-back"
              className={styles.backLink}
              onClick={() => setContentType(null)}
            >
              ← Back
            </button>
            <div className={styles.fields}>
              <div className={styles.field}>
                <label htmlFor="create-template-name" className={styles.fieldLabel}>
                  Name <span className={styles.required}>*</span>
                </label>
                <input
                  id="create-template-name"
                  type="text"
                  data-testid="create-template-name"
                  className={styles.input}
                  placeholder="Blog"
                  value={templateName}
                  onChange={handleTemplateNameChange}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="create-template-label" className={styles.fieldLabel}>
                  Label
                </label>
                <input
                  id="create-template-label"
                  type="text"
                  data-testid="create-template-label"
                  className={styles.input}
                  placeholder="Blog Post"
                  value={templateLabel}
                  onChange={handleTemplateLabelChange}
                />
              </div>
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <label htmlFor="create-template-description" className={styles.fieldLabel}>
                  Description <span className={styles.required}>*</span>
                </label>
                <textarea
                  id="create-template-description"
                  data-testid="create-template-description"
                  className={styles.textarea}
                  placeholder="Standard structure for all blog posts"
                  value={templateDescription}
                  onChange={(e) => setTemplateDescription(e.target.value)}
                />
              </div>
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <label htmlFor="create-template-pattern" className={styles.fieldLabel}>
                  Default URL pattern <span className={styles.required}>*</span>
                </label>
                <input
                  id="create-template-pattern"
                  type="text"
                  data-testid="create-template-pattern"
                  className={styles.input}
                  placeholder="/blog/:year/:month/:slug"
                  value={templatePattern}
                  onChange={(e) => setTemplatePattern(e.target.value)}
                />
                {templatePatternError && (
                  <span
                    data-testid="create-template-pattern-error"
                    role="alert"
                    className={styles.errorMessage}
                  >
                    {templatePatternError}
                  </span>
                )}
              </div>
            </div>
            </>
          ) : showPageFields ? (
          <div className={styles.fields}>
            <div className={styles.field}>
              <label htmlFor="create-page-title" className={styles.fieldLabel}>
                Page title
              </label>
              <input
                id="create-page-title"
                type="text"
                data-testid="create-page-title-input"
                className={styles.input}
                placeholder="New page"
                value={title}
                onChange={handleTitleChange}
              />
              {selectedCt && !slug.trim() && (
                <span
                  data-testid="create-page-title-required"
                  role="alert"
                  className={styles.errorMessage}
                >
                  Add a page title — it sets this page’s URL.
                </span>
              )}
            </div>
            {selectedCt && selectedCt.urlPattern ? (
              <div className={styles.field}>
                <label className={styles.fieldLabel}>URL</label>
                <div className={styles.routeBuilder}>
                  <span className={styles.routeStatic}>{host}</span>
                  {parsePattern(selectedCt.urlPattern).map((seg, i) => (
                    <React.Fragment key={`${seg.type}-${seg.value}-${i}`}>
                      <span className={styles.routeSep}>/</span>
                      {seg.type === 'static' ? (
                        <span className={styles.routeStatic}>{seg.value}</span>
                      ) : (
                        <input
                          type="text"
                          data-testid={`create-page-param-${seg.value}`}
                          className={styles.routeInput}
                          placeholder={seg.value}
                          aria-label={seg.value}
                          size={Math.max(seg.value.length, 4)}
                          value={seg.value === 'slug' ? slug : (params[seg.value] ?? '')}
                          onChange={(e) =>
                            seg.value === 'slug'
                              ? handleSlugChange(e)
                              : setParams((prev) => ({
                                  ...prev,
                                  [seg.value]: sanitizeSlug(e.target.value),
                                }))
                          }
                        />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ) : isPlugExternalData ? null : (
              <div className={styles.field}>
                <label htmlFor="create-page-slug" className={styles.fieldLabel}>
                  URL slug
                </label>
                <div className={styles.slugWrap}>
                  <span
                    data-testid="create-page-slug-prefix"
                    className={styles.slugPrefix}
                  >
                    {`${host} /`}
                  </span>
                  <input
                    id="create-page-slug"
                    type="text"
                    data-testid="create-page-slug-input"
                    className={styles.slugInput}
                    placeholder="new-page"
                    value={slug}
                    onChange={handleSlugChange}
                  />
                </div>
              </div>
            )}
          </div>
          ) : null}

          {isPlugExternalData && (
                  <div
                    data-testid="create-page-collection-builder"
                    className={styles.collectionBuilder}
                  >
                    <WizardQuestion
                      question="Where’s your data coming from?"
                      options={[
                        { value: 'configured', label: 'Use a configured source' },
                        { value: 'new', label: 'Add a new one' },
                      ]}
                      value={dataSourceMode}
                      onChange={(v) => setDataSourceMode(v as DataSourceMode)}
                    />

                    {dataSourceMode === 'configured' && (
                      <div className={styles.dsPane}>
                        <span className={styles.fieldLabel}>Select data source(s)</span>
                        {/* Dropdown rather than a long list; picking one adds it to
                            the selected chips below. Already-selected sources drop out. */}
                        <select
                          data-testid="create-page-source-select"
                          className={styles.input}
                          value=""
                          onChange={(e) => {
                            if (e.target.value) toggleSource(e.target.value);
                          }}
                          disabled={
                            availableSources.length === 0 ||
                            availableSources.every((s) =>
                              selectedDatasourceIds.includes(s.id),
                            )
                          }
                        >
                          <option value="">
                            {availableSources.length === 0
                              ? 'No data sources yet'
                              : 'Select a data source…'}
                          </option>
                          {availableSources
                            .filter((s) => !selectedDatasourceIds.includes(s.id))
                            .map((s) => {
                              const srcParams = s.inputs ?? [];
                              return (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                  {srcParams.length
                                    ? ` (${srcParams.map((i) => `:${i}`).join(' ')})`
                                    : ''}
                                </option>
                              );
                            })}
                        </select>
                      </div>
                    )}

                    {dataSourceMode === 'new' && (
                      <div className={styles.dsPane}>
                        <span className={styles.fieldLabel}>Add a data source</span>
                        <select
                          data-testid="create-page-new-type"
                          className={styles.input}
                          value={newType}
                          onChange={(e) => setNewType(e.target.value)}
                        >
                          <option value="https-json">JSON over HTTPS</option>
                          <option value="google-sheet">Google Sheet</option>
                          <option value="other">Other</option>
                        </select>
                        <input
                          type="text"
                          data-testid="create-page-new-name"
                          className={styles.input}
                          placeholder="Name (e.g. recipes)"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                        />
                        <input
                          type="text"
                          data-testid="create-page-new-url"
                          className={styles.input}
                          placeholder={
                            newType === 'google-sheet'
                              ? 'Google Sheet link'
                              : 'https://api.example.com/items/:id'
                          }
                          value={newUrl}
                          onChange={(e) => setNewUrl(e.target.value)}
                        />
                        <button
                          type="button"
                          data-testid="create-page-add-source"
                          className={styles.addParam}
                          disabled={!newName.trim()}
                          onClick={addCustomSource}
                        >
                          + Add source
                        </button>
                        <p
                          data-testid="create-page-add-source-note"
                          className={styles.fieldHint}
                        >
                          You can only add simple, publicly available data sources here.
                          For sources that need authentication or secrets, ask your
                          developer to configure one programmatically.
                        </p>
                      </div>
                    )}

                    {selectedSources.length > 0 && (
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>Selected sources</span>
                        <div className={styles.dsChips}>
                          {selectedSources.map((s) => (
                            <span
                              key={s.id}
                              data-testid={`create-page-selected-${s.id}`}
                              className={styles.paramChip}
                            >
                              {s.label}
                              <button
                                type="button"
                                data-testid={`create-page-deselect-${s.id}`}
                                className={styles.paramChipRemove}
                                aria-label={`Remove ${s.label}`}
                                onClick={() => toggleSource(s.id)}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Step 2: page structure. */}
                    {selectedSources.length > 0 && (
                      <WizardQuestion
                        question="How should the pages be structured?"
                        options={[
                          {
                            value: 'collection',
                            label: 'An index + a detail page per item',
                          },
                          { value: 'single', label: 'Everything on one page' },
                        ]}
                        value={pageStructure}
                        onChange={(v) => setPageStructure(v as PageStructure)}
                      />
                    )}

                    {/* Step 3: name it + confirm the route(s). */}
                    {pageStructure !== '' && (
                      <div className={styles.field}>
                        <label htmlFor="create-page-title" className={styles.fieldLabel}>
                          {pageStructure === 'collection' ? 'Index page title' : 'Page title'}
                        </label>
                        <input
                          id="create-page-title"
                          type="text"
                          data-testid="create-page-title-input"
                          className={styles.input}
                          placeholder="New page"
                          value={title}
                          onChange={handleTitleChange}
                        />
                      </div>
                    )}

                    {pageStructure === 'single' && (
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>
                          URL <span className={styles.required}>*</span>
                        </span>
                        <div
                          data-testid="create-page-route-preview"
                          className={styles.routeBuilder}
                        >
                          <span className={styles.routeStatic}>{host}</span>
                          <span className={styles.routeSep}>/</span>
                          <input
                            type="text"
                            data-testid="create-page-route-slug"
                            className={styles.routeInput}
                            placeholder="new-page"
                            aria-label="URL slug"
                            size={Math.max(slug.length, 8)}
                            value={slug}
                            onChange={handleSlugChange}
                          />
                        </div>
                      </div>
                    )}

                    {pageStructure === 'collection' && (
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>
                          Routes <span className={styles.required}>*</span>
                        </span>
                        {/* Two pages share the same slug base: an index page and a
                            per-item detail page. The index title prepares both. */}
                        <div
                          data-testid="create-page-route-index"
                          className={styles.routeBuilder}
                        >
                          <span className={styles.routeLabel}>Index page</span>
                          <span className={styles.routeStatic}>{host}</span>
                          <span className={styles.routeSep}>/</span>
                          <input
                            type="text"
                            data-testid="create-page-route-slug"
                            className={styles.routeInput}
                            placeholder="new-page"
                            aria-label="URL slug"
                            size={Math.max(slug.length, 8)}
                            value={slug}
                            onChange={handleSlugChange}
                          />
                        </div>
                        <div
                          data-testid="create-page-route-detail"
                          className={styles.routeBuilder}
                        >
                          <span className={styles.routeLabel}>Detail page</span>
                          <span className={styles.routeStatic}>{host}</span>
                          <span className={styles.routeSep}>/</span>
                          <span className={styles.routeStatic}>{slug || 'new-page'}</span>
                          {routeParamNames.map((name) => (
                            <React.Fragment key={name}>
                              <span className={styles.routeSep}>/</span>
                              <span
                                data-testid={`create-page-route-param-${name}`}
                                className={styles.paramChip}
                              >
                                <span className={styles.paramColon}>:</span>
                                {name}
                              </span>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    )}

                    {collectionNeedsParam && (
                      <div
                        data-testid="create-page-collection-needs-param"
                        role="alert"
                        className={styles.errorMessage}
                      >
                        This source lists items but can’t identify a single one, so a
                        detail page can’t be generated. Add a per-item source (one with
                        an <code>:id</code>-style input), or choose “Everything on one
                        page”.
                      </div>
                    )}

                    {pageStructure === 'collection' &&
                      selectedSources.length > 0 &&
                      !collectionNeedsParam && (
                        <p
                          data-testid="create-page-collection-summary"
                          className={styles.collectionSummary}
                        >
                          Generates one page per item ·{' '}
                          <code>{collectionRoutePattern}</code> · sources:{' '}
                          {selectedSources.map((s) => s.id).join(', ')}
                        </p>
                      )}

                    {/* Creation status, inline in the flow. */}
                    {submitting && (
                      <div data-testid="create-page-creating" className={styles.creating}>
                        <span className={styles.spinner} aria-hidden="true" />
                        Creating your pages…
                      </div>
                    )}

                    {recap && (
                      <div data-testid="create-page-recap" className={styles.recap}>
                        <p className={styles.recapLead}>
                          <strong>Done — pages created.</strong>
                        </p>
                        <p className={styles.recapBody}>
                          We created an <strong>index page</strong> (place a list or
                          search block there) and a <strong>detail page</strong> that
                          renders your remote data — open either to build its layout.
                        </p>
                        <p className={styles.recapRoutes}>
                          <code>{recap.indexPath}</code> · <code>{recap.dynamicPath}</code>
                        </p>
                        <div className={styles.footerActions}>
                          <button
                            type="button"
                            data-testid="create-page-recap-edit-index"
                            className={styles.cancelButton}
                            onClick={() => handleEditPage(recap.indexPath)}
                          >
                            Edit index page
                          </button>
                          <button
                            type="button"
                            data-testid="create-page-recap-edit-dynamic"
                            className={styles.submitButton}
                            onClick={() => handleEditPage(recap.dynamicPath)}
                          >
                            Edit detail page
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
          )}

          {error && (
            <div data-testid="create-page-error" role="alert" className={styles.errorMessage}>
              {error}
            </div>
          )}

          <footer className={styles.footer}>
            <div className={styles.footerActions}>
              <button
                type="button"
                data-testid="create-page-cancel"
                className={styles.cancelButton}
                onClick={onClose}
              >
                {recap ? 'Done' : 'Cancel'}
              </button>
              {/* Once the recap is shown the pages exist; and for the plug flow
                  the inline loader stands in for the button while creating. */}
              {!recap && !(isPlugExternalData && submitting) && (
                <button
                  type="submit"
                  data-testid="create-page-submit"
                  className={styles.submitButton}
                  disabled={
                    submitting ||
                    (isTemplateScreen
                      ? !canCreateTemplate
                      : isPlugExternalData
                        ? !pageStructure || !slug.trim() || collectionNeedsParam
                        : selectedCt
                          ? !canCreateContentType
                          : selected !== 'blank')
                  }
                  aria-busy={submitting}
                >
                  {submitting ? (
                    <>
                      <span className={styles.spinner} aria-hidden="true" />
                      Creating…
                    </>
                  ) : isTemplateScreen ? (
                    'Create template'
                  ) : isPlugExternalData && pageStructure === 'collection' ? (
                    '+ Create pages'
                  ) : (
                    '+ Create page'
                  )}
                </button>
              )}
            </div>
          </footer>
        </form>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
