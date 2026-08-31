/**
 * Translations Endpoint
 *
 * API operations for localization: creating and listing translation variants
 * of a canonical document.
 */

import type {
  AuthorityOverridesResult,
  CreateTranslationParams,
  CreateTranslationResult,
  ListTranslationsResult,
  PropAuthority,
} from '../types.js';
import type { BaseEndpoint } from './base.js';

export class TranslationsEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * Create a translation of a canonical document in a target locale.
   */
  async create(params: CreateTranslationParams): Promise<CreateTranslationResult> {
    const body: { locale: string; path?: string } = { locale: params.locale };
    if (params.path !== undefined) {
      body.path = params.path;
    }

    return this.base.request<CreateTranslationResult>(
      `/api/sites/${params.siteId}/branches/${params.branchId}/documents/${params.canonicalDocumentId}/translations`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
  }

  /**
   * List a canonical document's translation variants.
   */
  async listVariants(
    siteId: string,
    branchId: string,
    canonicalDocumentId: string,
  ): Promise<ListTranslationsResult> {
    return this.base.request<ListTranslationsResult>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${canonicalDocumentId}/translations`,
      { method: 'GET' },
    );
  }

  /**
   * Get the authority-override map for a translation document.
   */
  async getAuthorityOverrides(
    siteId: string,
    branchId: string,
    documentId: string,
  ): Promise<AuthorityOverridesResult> {
    return this.base.request<AuthorityOverridesResult>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/authority-overrides`,
      { method: 'GET' },
    );
  }

  /**
   * Set a prop's authority for a translation. Authority 'locale' breaks
   * inheritance; 'canonical' records inheritance explicitly. Returns the full
   * updated map.
   */
  async setAuthorityOverride(
    siteId: string,
    branchId: string,
    documentId: string,
    params: { slotId: string; propName: string; authority: PropAuthority },
  ): Promise<AuthorityOverridesResult> {
    return this.base.request<AuthorityOverridesResult>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/authority-overrides`,
      {
        method: 'PUT',
        body: JSON.stringify({
          slotId: params.slotId,
          propName: params.propName,
          authority: params.authority,
        }),
      },
    );
  }

  /**
   * Clear a prop's authority override for a translation, returning the prop to
   * its slot's template default and then `defaultAuthority`. Returns the full
   * updated map with emptied slots pruned.
   */
  async clearAuthorityOverride(
    siteId: string,
    branchId: string,
    documentId: string,
    params: { slotId: string; propName: string },
  ): Promise<AuthorityOverridesResult> {
    return this.base.request<AuthorityOverridesResult>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/authority-overrides`,
      {
        method: 'DELETE',
        body: JSON.stringify({ slotId: params.slotId, propName: params.propName }),
      },
    );
  }
}
