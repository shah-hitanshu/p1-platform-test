/**
 * Collaborative State System - Redirect Types
 *
 * Redirect records stored as documents at _registry/redirects/*
 */

import type { RedirectType } from './enums';

/**
 * Shape of the document snapshot for a redirect record.
 */
export interface RedirectSnapshot {
  fromPath: string;
  /** @deprecated Use fromPath. Kept for reading pre-rename snapshots. */
  origin?: string;
  destination: string;
  redirectType: RedirectType;
  parenting: boolean;
}

export const VALID_REDIRECT_TYPES: readonly RedirectType[] = ['permanent', 'temporary'] as const;

export function isValidRedirectType(value: unknown): value is RedirectType {
  return typeof value === 'string' && (VALID_REDIRECT_TYPES as readonly string[]).includes(value);
}

export interface RedirectBody {
  fromPath?: string;
  destination?: string;
  redirectType?: string;
  parenting?: boolean;
}

export function isRedirectBody(value: unknown): value is RedirectBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.fromPath !== undefined && typeof v.fromPath !== 'string') return false;
  if (v.destination !== undefined && typeof v.destination !== 'string') return false;
  if (v.redirectType !== undefined && typeof v.redirectType !== 'string') return false;
  if (v.parenting !== undefined && typeof v.parenting !== 'boolean') return false;
  return true;
}
