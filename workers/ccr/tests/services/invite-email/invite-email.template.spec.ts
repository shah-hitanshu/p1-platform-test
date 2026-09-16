import { describe, it, expect } from 'vitest';
import { escapeHtml, renderInviteEmail } from '../../../src/services/invite-email/invite-email.template';

const base = {
  inviterName: 'Ada Lovelace',
  organizationName: 'Analytical Engines',
  dashboardLink: 'https://content.pantheon.io/auth/login?returnTo=%2Fdashboard%2F%3Forg%3Dabc',
};

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
});

describe('renderInviteEmail', () => {
  it('names the Administrator role for an admin invite', () => {
    const { html, text } = renderInviteEmail({ ...base, role: 'admin' });
    expect(html).toContain('invited as an<br/>Administrator for Analytical Engines');
    expect(text).toContain('invited as an Administrator for Analytical Engines');
  });

  it('names the Member role for a member invite', () => {
    const { html, text } = renderInviteEmail({ ...base, role: 'member' });
    expect(html).toContain('invited as a<br/>Member for Analytical Engines');
    expect(html).not.toContain('Administrator');
    expect(text).not.toContain('Administrator');
  });

  it('puts the inviter, organization and link in both parts', () => {
    const { html, text } = renderInviteEmail({ ...base, role: 'admin' });
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain(`href="${base.dashboardLink}"`);
    expect(text).toContain('Ada Lovelace has invited you to Analytical Engines.');
    expect(text).toContain(base.dashboardLink);
  });

  it('escapes markup in every interpolated value', () => {
    const { html } = renderInviteEmail({
      inviterName: '<b>x</b>',
      organizationName: '<script>alert(1)</script>',
      role: 'admin',
      dashboardLink: 'https://x.test/?a=1&b=2',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="https://x.test/?a=1&amp;b=2"');
  });

  it('leaves no unrendered placeholder behind', () => {
    const { html } = renderInviteEmail({ ...base, role: 'member' });
    expect(html).not.toMatch(/__[A-Z]+__|\$\{/);
  });
});
