import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildDashboardLink,
  sanitizeForEmail,
  sendInviteEmail,
} from '../../../src/services/invite-email/invite-email.service';
import type { Env } from '../../../src/env';

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@pantheon-systems/p1-telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pantheon-systems/p1-telemetry')>();
  return { ...actual, getLogger: () => logger };
});

const ORG_ID = '11111111-1111-4111-8111-111111111111';

const PAYLOAD = {
  email: 'invitee@example.com',
  organizationId: ORG_ID,
  organizationName: 'Analytical Engines',
  role: 'admin' as const,
  inviterEmail: 'ada@example.com',
  inviterName: 'Ada Lovelace',
};

const makeEnv = (o: Partial<Env> = {}) =>
  ({
    ENVIRONMENT: 'staging',
    SENDGRID_API_KEY: 'SG.key',
    DASHBOARD_URL: 'https://staging.content.pantheon.io',
    ...o,
  }) as unknown as Env;

interface SentMail {
  personalizations: { to: { email: string }[] }[];
  from: { name: string; email: string };
  reply_to: { email: string };
  subject: string;
  content: { type: string; value: string }[];
  categories: string[];
}

describe('sanitizeForEmail', () => {
  it('strips control, bidi and format characters', () => {
    expect(sanitizeForEmail('a\r\nb\u202Ec\u200Bd\uFEFF', 100)).toBe('abcd');
  });

  it('truncates by code point so a cut emoji leaves no lone surrogate', () => {
    const out = sanitizeForEmail('ab😀', 3);
    expect(out).toBe('ab😀');
    expect(sanitizeForEmail('ab😀', 2)).toBe('ab');
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('buildDashboardLink', () => {
  it('embeds the organization id in returnTo and tolerates a trailing slash', () => {
    const expected = `https://d.test/auth/login?returnTo=${encodeURIComponent(`/dashboard/?org=${ORG_ID}`)}`;
    expect(buildDashboardLink('https://d.test', ORG_ID)).toBe(expected);
    expect(buildDashboardLink('https://d.test/', ORG_ID)).toBe(expected);
  });
});

describe('sendInviteEmail', () => {
  const fetchMock = vi.fn();

  const sent = (): SentMail => JSON.parse(fetchMock.mock.calls[0][1].body as string) as SentMail;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to SendGrid with the bearer key and reports true on 202', async () => {
    await expect(sendInviteEmail(makeEnv(), PAYLOAD)).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer SG.key');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('addresses one recipient and uses the shared Content Publisher sender identity', async () => {
    await sendInviteEmail(makeEnv(), PAYLOAD);
    const mail = sent();
    expect(mail.personalizations).toEqual([{ to: [{ email: 'invitee@example.com' }] }]);
    expect(mail.from).toEqual({ name: 'Pantheon Content Publisher', email: 'no-reply@pantheon.io' });
    expect(mail.reply_to).toEqual({ email: 'pcc-support@pantheon.io' });
    expect(mail.categories).toEqual(['staging']);
  });

  it('sends a plaintext part before the HTML part, both carrying the dashboard link', async () => {
    await sendInviteEmail(makeEnv(), PAYLOAD);
    const [text, html] = sent().content;
    const link = buildDashboardLink('https://staging.content.pantheon.io', ORG_ID);
    expect(text.type).toBe('text/plain');
    expect(html.type).toBe('text/html');
    expect(text.value).toContain(link);
    expect(html.value).toContain(`href="${link}"`);
    expect(html.value).toContain('Administrator for Analytical Engines');
  });

  it('builds the subject from the sanitized inviter and organization names', async () => {
    await sendInviteEmail(makeEnv(), PAYLOAD);
    expect(sent().subject).toBe('Ada Lovelace invited you to Analytical Engines on Pantheon');
  });

  it('falls back to the inviter email when the display name is missing or empty after stripping', async () => {
    await sendInviteEmail(makeEnv(), { ...PAYLOAD, inviterName: undefined });
    expect(sent().subject).toBe('ada@example.com invited you to Analytical Engines on Pantheon');

    fetchMock.mockClear();
    await sendInviteEmail(makeEnv(), { ...PAYLOAD, inviterName: '\u200B \u200D' });
    expect(sent().subject).toBe('ada@example.com invited you to Analytical Engines on Pantheon');
  });

  it('strips CRLF and bounds a long organization name in subject and body', async () => {
    const longName = 'x'.repeat(300);
    await sendInviteEmail(makeEnv(), { ...PAYLOAD, organizationName: `Evil\r\nBcc: a@b.c ${longName}` });
    const mail = sent();
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toContain('x'.repeat(60 - 'EvilBcc: a@b.c '.length));
    expect(mail.subject).not.toContain('x'.repeat(61));
    const html = mail.content[1].value;
    expect(html).not.toContain('x'.repeat(101));
    expect(html).toContain('x'.repeat(100 - 'EvilBcc: a@b.c '.length));
  });

  it('escapes markup from the organization name in the HTML part', async () => {
    await sendInviteEmail(makeEnv(), { ...PAYLOAD, organizationName: '<script>x</script>' });
    const html = sent().content[1].value;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('refuses to send when the organization name is empty after stripping', async () => {
    await expect(sendInviteEmail(makeEnv(), { ...PAYLOAD, organizationName: '\u200B\u200C' })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports undefined, without calling out, when the API key is unset or empty', async () => {
    await expect(sendInviteEmail(makeEnv({ SENDGRID_API_KEY: undefined }), PAYLOAD)).resolves.toBeUndefined();
    await expect(sendInviteEmail(makeEnv({ SENDGRID_API_KEY: '' }), PAYLOAD)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports undefined, without calling out, when the dashboard URL is unset', async () => {
    await expect(sendInviteEmail(makeEnv({ DASHBOARD_URL: undefined }), PAYLOAD)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs the two unconfigured causes distinctly', async () => {
    await sendInviteEmail(makeEnv({ SENDGRID_API_KEY: undefined }), PAYLOAD);
    await sendInviteEmail(makeEnv({ DASHBOARD_URL: undefined }), PAYLOAD);
    expect(logger.warn.mock.calls[0][0]).toBe('invite_email_unconfigured');
    expect(logger.warn.mock.calls[1][0]).toBe('invite_email_no_dashboard_url');
  });

  it('reports false on any non-2xx status', async () => {
    for (const status of [400, 401, 429, 500, 503]) {
      fetchMock.mockResolvedValueOnce(new Response('{}', { status }));
      await expect(sendInviteEmail(makeEnv(), PAYLOAD)).resolves.toBe(false);
    }
  });

  it('honours SENDGRID_API_URL only when ENVIRONMENT is local', async () => {
    await sendInviteEmail(
      makeEnv({ ENVIRONMENT: 'local', SENDGRID_API_URL: 'http://127.0.0.1:8025/v3/mail/send' }),
      PAYLOAD,
    );
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8025/v3/mail/send');

    fetchMock.mockClear();
    await sendInviteEmail(
      makeEnv({ ENVIRONMENT: 'production', SENDGRID_API_URL: 'http://evil.test' }),
      PAYLOAD,
    );
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.sendgrid.com/v3/mail/send');
  });

  it('reports false when the fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    await expect(sendInviteEmail(makeEnv(), PAYLOAD)).resolves.toBe(false);
  });
});
