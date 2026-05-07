import { describe, expect, it } from 'vitest';

import {
  mono,
  muted,
  card,
  infoPanel,
  sectionLabel,
  errorText,
  backdrop,
  modalPanel,
  primaryButton,
  secondaryButton,
  dangerButton,
  ghostButton,
} from '../../data/styles';

describe('style tokens', () => {
  it('mono has fontFamily', () => {
    expect(mono.fontFamily).toContain('monospace');
  });

  it('muted has color and fontSize', () => {
    expect(muted.color).toBeDefined();
    expect(muted.fontSize).toBe(12);
  });

  it('card has border and borderRadius', () => {
    expect(card.border).toBeDefined();
    expect(card.borderRadius).toBe(8);
  });

  it('infoPanel extends card with background', () => {
    expect(infoPanel.borderRadius).toBe(8);
    expect(infoPanel.background).toBeDefined();
  });

  it('sectionLabel has uppercase transform', () => {
    expect(sectionLabel.textTransform).toBe('uppercase');
  });

  it('errorText has red-ish color', () => {
    expect(errorText.color).toBeDefined();
  });

  it('backdrop is fixed fullscreen', () => {
    expect(backdrop.position).toBe('fixed');
    expect(backdrop.inset).toBe(0);
  });

  it('modalPanel has flexbox layout', () => {
    expect(modalPanel.display).toBe('flex');
    expect(modalPanel.flexDirection).toBe('column');
  });

  it('button variants have cursor pointer', () => {
    expect(primaryButton.cursor).toBe('pointer');
    expect(secondaryButton.cursor).toBe('pointer');
    expect(dangerButton.cursor).toBe('pointer');
    expect(ghostButton.cursor).toBe('pointer');
  });

  it('primaryButton has no border', () => {
    expect(primaryButton.border).toBe('none');
  });

  it('ghostButton has transparent background', () => {
    expect(ghostButton.background).toBe('transparent');
  });
});
