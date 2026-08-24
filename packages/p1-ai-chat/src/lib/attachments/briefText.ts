import { AttachmentError } from './attachmentError.js';
import { MAX_BRIEF_CHARS } from './fileRules.js';

// Someone dropping a page in means "here is what it says". Sending the source would spend the
// turn's context on markup, and invites the agent to treat it as part of the brief.

const NOT_PROSE = 'script, style, noscript, template, svg';

// `textContent` joins with no separator at all, so both lists exist to put the breaks back.

/** Separated by a blank line, so a heading does not read as the first line of the paragraph. */
const PARAGRAPHS = [
  'p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'main',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'dl', 'table',
  'blockquote', 'pre', 'hr', 'form', 'fieldset', 'address',
].join(', ');

/** One line each: a list of items is not a run of paragraphs. */
const LINES = ['li', 'dt', 'dd', 'tr', 'td', 'th', 'caption', 'figcaption', 'legend'].join(', ');

/** Collapse the whitespace HTML leaves behind, down to at most one blank line. */
function tidy(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim());
  const kept: string[] = [];
  for (const line of lines) {
    // Markup leaves a blank line between almost every element, so a run of them says nothing.
    if (line === '' && (kept.length === 0 || kept[kept.length - 1] === '')) continue;
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
  return kept.join('\n');
}

export function htmlToText(html: string): string {
  let parsed: Document;
  try {
    parsed = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    throw new AttachmentError('This page could not be read.');
  }
  for (const element of parsed.querySelectorAll(NOT_PROSE)) element.remove();
  // `<br>` is void, so it is replaced rather than appended to.
  for (const element of parsed.querySelectorAll('br')) element.replaceWith('\n');
  for (const element of parsed.querySelectorAll(LINES)) element.append('\n');
  for (const element of parsed.querySelectorAll(PARAGRAPHS)) element.append('\n\n');
  // `body` is absent only if parsing produced no document at all.
  return tidy(parsed.body?.textContent ?? '');
}

export function truncateBrief(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_BRIEF_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_BRIEF_CHARS), truncated: true };
}
