import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { Env } from '../../env';
import { renderInviteEmail } from './invite-email.template';

const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

function resolveSendgridUrl(env: Env): string {
  // Only local dev may redirect sends; a deployed worker always hits SendGrid.
  if (env.ENVIRONMENT === 'local' && env.SENDGRID_API_URL !== undefined && env.SENDGRID_API_URL !== '') {
    return env.SENDGRID_API_URL;
  }
  return SENDGRID_URL;
}

// Best-effort send: membership is already committed. 2s bounds worst-case
// add-user latency while leaving SendGrid headroom.
const REQUEST_TIMEOUT_MS = 2000;

const SUBJECT_LIMIT = 60;
const BODY_LIMIT = 100;

// The same identity Content Publisher's other emails go out under.
const FROM = { name: 'Pantheon Content Publisher', email: 'no-reply@pantheon.io' };
const REPLY_TO = { email: 'pcc-support@pantheon.io' };

// C0 controls, DEL, C1 range, plus Unicode bidi/format chars (RTL override etc.)
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export interface InviteEmailPayload {
  email: string;
  organizationId: string;
  organizationName: string;
  role: 'admin' | 'member';
  inviterEmail: string;
  inviterName?: string;
}

/**
 * Organization and inviter names reach the email from inputs nobody bounds.
 * Strip control characters and truncate by code point, so a cut emoji cannot
 * leave a lone surrogate that SendGrid rejects.
 */
export function sanitizeForEmail(value: string, limit: number): string {
  return Array.from(value.replace(CONTROL_CHARS, '')).slice(0, limit).join('');
}

export function buildDashboardLink(dashboardUrl: string, organizationId: string): string {
  const returnTo = encodeURIComponent(`/dashboard/?org=${organizationId}`);
  return `${dashboardUrl.replace(/\/$/, '')}/auth/login?returnTo=${returnTo}`;
}

/** Whether this deployment can send invite email at all. */
export function isInviteEmailConfigured(env: Env): boolean {
  return Boolean(env.SENDGRID_API_KEY) && Boolean(env.DASHBOARD_URL);
}

/**
 * true sent, false not confirmed, undefined not applicable. Never throws.
 */
export async function sendInviteEmail(
  env: Env,
  payload: InviteEmailPayload,
): Promise<boolean | undefined> {
  const apiKey = env.SENDGRID_API_KEY;
  const dashboardUrl = env.DASHBOARD_URL;

  if (apiKey === undefined || apiKey === '') {
    getLogger().warn('invite_email_unconfigured', { environment: env.ENVIRONMENT });
    return undefined;
  }
  if (dashboardUrl === undefined || dashboardUrl === '') {
    getLogger().warn('invite_email_no_dashboard_url', { environment: env.ENVIRONMENT });
    return undefined;
  }

  const organizationName = sanitizeForEmail(payload.organizationName, BODY_LIMIT).trim();
  if (organizationName === '') {
    getLogger().warn('invite_email_empty_organization_name', { organizationId: payload.organizationId });
    return false;
  }
  const inviterName =
    sanitizeForEmail(payload.inviterName ?? '', BODY_LIMIT).trim() ||
    sanitizeForEmail(payload.inviterEmail, BODY_LIMIT);

  const subject =
    `${sanitizeForEmail(inviterName, SUBJECT_LIMIT)} invited you to ` +
    `${sanitizeForEmail(organizationName, SUBJECT_LIMIT)} on Pantheon`;

  const { html, text } = renderInviteEmail({
    inviterName,
    organizationName,
    role: payload.role,
    dashboardLink: buildDashboardLink(dashboardUrl, payload.organizationId),
  });

  try {
    const response = await fetch(resolveSendgridUrl(env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: payload.email }] }],
        from: FROM,
        reply_to: REPLY_TO,
        subject,
        // SendGrid requires text/plain to precede text/html.
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
        categories: [env.ENVIRONMENT],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      getLogger().error('Invite email returned a non-OK status', new Error(`HTTP ${String(response.status)}`), { status: response.status });
      return false;
    }

    return true;
  } catch (error) {
    getLogger().error('Invite email request failed', error instanceof Error ? error : new Error(String(error)), {});
    return false;
  }
}
