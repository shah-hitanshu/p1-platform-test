import { IMAGE_TYPES, type FileFacts } from './fileRules.js';

// Browsers report no `type` at all for `.md`, and Windows with Excel installed reports
// `application/vnd.ms-excel` for `.csv`. Neither is a type the media API accepts, so the
// extension has to decide for text.
const BY_EXTENSION: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.text': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
};

/**
 * The content type a file is stored under. Images are read from `type`, matching how
 * checkAttachment decides a file is an image; everything else from the extension.
 */
export function contentTypeFor(file: FileFacts): string {
  if (IMAGE_TYPES.has(file.type)) return file.type;
  for (const [extension, type] of Object.entries(BY_EXTENSION)) {
    if (file.name.toLowerCase().endsWith(extension)) return type;
  }
  // Everything here passed checkAttachment as a document, so it is text of some kind.
  return 'text/plain';
}
