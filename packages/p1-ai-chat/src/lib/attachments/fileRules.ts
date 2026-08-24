// SVG is left out deliberately: it is a document rather than a bitmap, can carry script, and
// taints a canvas.
export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

/** Browsers report no `type` at all for `.md`, so the extension has to be consulted too. */
export const DOCUMENT_EXTENSIONS = ['.md', '.markdown', '.txt', '.text', '.csv', '.html', '.htm'];

const HTML_EXTENSIONS = ['.html', '.htm'];

export const RICH_DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.rtf', '.odt', '.pages'];

export const MAX_ATTACHMENTS = 4;

/** Read before decoding: a huge original costs memory to decode, however small it ends up. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const MAX_DOCUMENT_BYTES = 512 * 1024;

/** The Worker truncates too; this cap exists so the panel can say the brief was shortened. */
export const MAX_BRIEF_CHARS = 20_000;

export const ACCEPTED_FILE_TYPES = [...IMAGE_TYPES, ...DOCUMENT_EXTENSIONS].join(',');

/** The parts of a `File` the rules read. Named separately so tests need no `File` constructor. */
export interface FileFacts {
  name: string;
  type: string;
  size: number;
}

export function hasExtension(name: string, extensions: string[]): boolean {
  const lower = name.toLowerCase();
  return extensions.some(extension => lower.endsWith(extension));
}

/** Whether a brief is a web page, whose markup has to come off before the agent reads it. */
export function isHtmlFile(file: FileFacts): boolean {
  return file.type === 'text/html' || hasExtension(file.name, HTML_EXTENSIONS);
}
