/**
 * Tests for document path normalization and validation
 */

import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  validatePath,
  InvalidDocumentPathError,
} from '../../src/services/document-types';

describe('normalizePath', () => {
  it('should keep "/" as the canonical root path', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('should strip leading slash', () => {
    expect(normalizePath('/example')).toBe('example');
    expect(normalizePath('/pages/home')).toBe('pages/home');
  });

  it('should strip trailing slash', () => {
    expect(normalizePath('example/')).toBe('example');
    expect(normalizePath('pages/home/')).toBe('pages/home');
  });

  it('should strip both leading and trailing slashes', () => {
    expect(normalizePath('/example/')).toBe('example');
    expect(normalizePath('/pages/about/')).toBe('pages/about');
  });

  it('should strip multiple leading slashes', () => {
    expect(normalizePath('//example')).toBe('example');
    expect(normalizePath('///pages/home')).toBe('pages/home');
  });

  it('should strip multiple trailing slashes', () => {
    expect(normalizePath('example//')).toBe('example');
    expect(normalizePath('pages/home///')).toBe('pages/home');
  });

  it('should preserve internal slashes', () => {
    expect(normalizePath('/pages/about/team/')).toBe('pages/about/team');
    expect(normalizePath('a/b/c/d')).toBe('a/b/c/d');
  });

  it('should handle paths that are already normalized', () => {
    expect(normalizePath('pages/home')).toBe('pages/home');
    expect(normalizePath('example')).toBe('example');
  });

  it('should trim whitespace before processing', () => {
    expect(normalizePath('  /example/  ')).toBe('example');
    expect(normalizePath(' pages/home ')).toBe('pages/home');
  });

  it('should throw for empty path', () => {
    expect(() => normalizePath('')).toThrow(InvalidDocumentPathError);
    expect(() => normalizePath('')).toThrow('path cannot be empty');
  });

  it('should throw for whitespace-only path', () => {
    expect(() => normalizePath('  ')).toThrow(InvalidDocumentPathError);
    expect(() => normalizePath('\t\n')).toThrow(InvalidDocumentPathError);
  });

  it('should throw for multi-slash-only paths', () => {
    expect(() => normalizePath('//')).toThrow(InvalidDocumentPathError);
    expect(() => normalizePath('///')).toThrow(InvalidDocumentPathError);
  });
});

describe('validatePath', () => {
  it('should reject empty string', () => {
    expect(() => { validatePath(''); }).toThrow(InvalidDocumentPathError);
  });

  it('should accept normalized paths without slashes', () => {
    expect(() => { validatePath('example'); }).not.toThrow();
    expect(() => { validatePath('pages/home'); }).not.toThrow();
    expect(() => { validatePath('deeply/nested/path/structure'); }).not.toThrow();
  });

  it('should reject paths with traversal sequences', () => {
    expect(() => { validatePath('pages/../etc/passwd'); }).toThrow(InvalidDocumentPathError);
    expect(() => { validatePath('pages/../etc/passwd'); }).toThrow('path cannot contain traversal sequences');
  });

  it('should reject paths starting with traversal', () => {
    expect(() => { validatePath('../sensitive'); }).toThrow(InvalidDocumentPathError);
    expect(() => { validatePath('../../etc/hosts'); }).toThrow(InvalidDocumentPathError);
  });

  it('should reject paths ending with traversal', () => {
    expect(() => { validatePath('pages/..'); }).toThrow(InvalidDocumentPathError);
  });

  it('should reject paths containing traversal in the middle', () => {
    expect(() => { validatePath('a/b/../c'); }).toThrow(InvalidDocumentPathError);
  });

  it('should accept paths with ".." as part of a name (not traversal)', () => {
    // The new implementation only rejects ".." as a complete segment
    // Filenames containing ".." in the middle (like "file..name") are allowed
    expect(() => { validatePath('file..name'); }).not.toThrow();
    expect(() => { validatePath('changelog..2024.md'); }).not.toThrow();
    expect(() => { validatePath('foo/file..bar/baz'); }).not.toThrow();
  });

  it('should reject "." as a complete path segment', () => {
    expect(() => { validatePath('.'); }).toThrow(InvalidDocumentPathError);
    expect(() => { validatePath('pages/./home'); }).toThrow(InvalidDocumentPathError);
    expect(() => { validatePath('./file'); }).toThrow(InvalidDocumentPathError);
    expect(() => { validatePath('file/.'); }).toThrow(InvalidDocumentPathError);
  });

  it('should accept "." as part of a filename', () => {
    expect(() => { validatePath('file.txt'); }).not.toThrow();
    expect(() => { validatePath('.hidden'); }).not.toThrow();
    expect(() => { validatePath('pages/.hidden/file'); }).not.toThrow();
  });
});

describe('validatePath with normalizePath integration', () => {
  it('should validate after normalization for root path', () => {
    const normalized = normalizePath('/');
    expect(() => { validatePath(normalized); }).not.toThrow();
    expect(normalized).toBe('/');
  });

  it('should validate after normalization for regular paths', () => {
    const normalized1 = normalizePath('/pages/about/');
    expect(() => { validatePath(normalized1); }).not.toThrow();
    expect(normalized1).toBe('pages/about');

    const normalized2 = normalizePath('example/');
    expect(() => { validatePath(normalized2); }).not.toThrow();
    expect(normalized2).toBe('example');
  });

  it('should reject traversal after normalization', () => {
    const normalized = normalizePath('/../sensitive');
    expect(() => { validatePath(normalized); }).toThrow(InvalidDocumentPathError);
  });
});

describe('Security validations', () => {
  it('should reject paths exceeding maximum length', () => {
    const longPath = 'a'.repeat(10000);
    expect(() => { normalizePath(longPath); }).toThrow(InvalidDocumentPathError);
    expect(() => { normalizePath(longPath); }).toThrow('path length exceeds maximum');
  });

  it('should reject paths with NULL bytes', () => {
    expect(() => { validatePath('pages/\0/home'); }).toThrow(InvalidDocumentPathError);
    expect(() => { validatePath('pages/\0/home'); }).toThrow('NULL bytes');
  });

  it('should reject paths with control characters', () => {
    expect(() => { validatePath('pages/\x01/home'); }).toThrow(InvalidDocumentPathError);
    expect(() => { validatePath('pages/\x01/home'); }).toThrow('control characters');
    expect(() => { validatePath('pages/\x1F/home'); }).toThrow(InvalidDocumentPathError);
    expect(() => { validatePath('pages/\x7F/home'); }).toThrow(InvalidDocumentPathError);
  });

  it('should reject paths with internal whitespace', () => {
    expect(() => { validatePath('pages/ /home'); }).toThrow(InvalidDocumentPathError);
    expect(() => { validatePath('pages/ /home'); }).toThrow('whitespace');
    expect(() => { validatePath('pages/\t/home'); }).toThrow(InvalidDocumentPathError);
    expect(() => { validatePath('pages/ho me'); }).toThrow(InvalidDocumentPathError);
  });

  it('should normalize backslashes to forward slashes', () => {
    expect(normalizePath('pages\\home')).toBe('pages/home');
    expect(normalizePath('a\\b\\c')).toBe('a/b/c');
    expect(normalizePath('pages\\home\\index')).toBe('pages/home/index');
  });

  it('should collapse multiple slashes in path middle', () => {
    expect(normalizePath('pages//home')).toBe('pages/home');
    expect(normalizePath('a///b///c')).toBe('a/b/c');
    expect(normalizePath('pages////home')).toBe('pages/home');
  });
});

describe('Edge case handling', () => {
  it('should handle URL-encoded paths correctly', () => {
    // Double slash after decoding should be normalized
    const decodedPath = decodeURIComponent('pages%2F%2Fhome');
    expect(normalizePath(decodedPath)).toBe('pages/home');

    // Encoded backslash should be normalized
    const decodedBackslash = decodeURIComponent('pages%5Chome');
    expect(normalizePath(decodedBackslash)).toBe('pages/home');
  });

  it('should handle mixed slashes and backslashes', () => {
    expect(normalizePath('pages\\home/index')).toBe('pages/home/index');
    expect(normalizePath('pages/home\\index')).toBe('pages/home/index');
  });

  it('should allow reasonable path lengths', () => {
    const reasonablePath = 'a'.repeat(1000);
    expect(() => { normalizePath(reasonablePath); }).not.toThrow();
  });

  it('should allow hidden files with leading dots', () => {
    expect(() => { validatePath('.hidden'); }).not.toThrow();
    expect(() => { validatePath('.git/config'); }).not.toThrow();
    expect(() => { validatePath('pages/.htaccess'); }).not.toThrow();
  });
});
