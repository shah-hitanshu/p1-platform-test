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

/**
 * Reads a redirect out of a stored document snapshot.
 *
 * Snapshots persist as `Record<string, unknown>`, so nothing about their shape is
 * guaranteed — this validates rather than asserting, and resolves the deprecated
 * `origin` field so callers only ever see `fromPath`. Returns null for a snapshot
 * that can't describe a usable redirect.
 */
export function readRedirectSnapshot(
  value: Record<string, unknown> | undefined,
): RedirectSnapshot | null {
  if (value === undefined) return null;

  const fromPath =
    typeof value.fromPath === 'string'
      ? value.fromPath
      : typeof value.origin === 'string'
        ? value.origin
        : null;
  const destination = typeof value.destination === 'string' ? value.destination : null;
  if (fromPath === null || destination === null) return null;

  return {
    fromPath,
    destination,
    redirectType: isValidRedirectType(value.redirectType) ? value.redirectType : 'permanent',
    parenting: value.parenting === true,
  };
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
