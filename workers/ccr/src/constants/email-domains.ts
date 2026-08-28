/**
 * Public email domain providers used to distinguish personal email
 * addresses from company/business email addresses when deriving an
 * organization name (see deriveOrgNameFromEmail in organization-service.ts).
 */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com',
  'live.com', 'msn.com', 'me.com', 'mac.com', 'fastmail.com',
]);
