import { createContext, useContext } from 'react';

import type { ProposalPreviewSource } from './proposal-preview.js';

/**
 * Where a proposal card finds the page to read its before values from.
 *
 * A getter rather than the data itself, so the host is not re-rendered on every
 * keystroke: the card reads the page when it renders and not otherwise. Whoever
 * mounts the thread inside the editor provides one; anywhere else the card reads
 * only what the operations themselves say.
 */
export type ProposalPreviewLookup = () => ProposalPreviewSource;

const noPage: ProposalPreviewLookup = () => ({});

export const ProposalPreviewContext = createContext<ProposalPreviewLookup>(noPage);

export function useProposalPreviewSource(): ProposalPreviewSource {
  return useContext(ProposalPreviewContext)();
}
