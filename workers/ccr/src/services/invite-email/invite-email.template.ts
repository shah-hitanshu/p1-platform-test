// Rendered once from pantheon-content-cloud's react-email layout
// (packages/functions/src/lib/emails/templates/base.tsx). If the brand
// changes, regenerate there rather than hand-editing the markup here.

const ROLE_LABEL = { admin: 'Administrator', member: 'Member' } as const;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

export interface InviteEmailProps {
  inviterName: string;
  organizationName: string;
  role: keyof typeof ROLE_LABEL;
  dashboardLink: string;
}

export function renderInviteEmail(props: InviteEmailProps): { html: string; text: string } {
  const roleLabel = ROLE_LABEL[props.role];
  const article = props.role === 'admin' ? 'an' : 'a';
  const org = escapeHtml(props.organizationName);
  const inviter = escapeHtml(props.inviterName);
  const link = escapeHtml(props.dashboardLink);

  const text = [
    `You've been invited as ${article} ${roleLabel} for ${props.organizationName}`,
    '',
    `${props.inviterName} has invited you to ${props.organizationName}.`,
    '',
    `Go to Pantheon: ${props.dashboardLink}`,
    '',
    'If you have any problems, please contact the Pantheon support team at helpdesk@pantheon.io.',
    'Pantheon systems, inc.',
    '717 California St., 3rd Fl. San Francisco, CA 94108',
    '',
  ].join('\n');

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html dir="ltr" lang="en"><head><link rel="preload" as="image" href="https://raw.githubusercontent.com/pantheon-systems/add-on-resources/main/k/pantheon-logo-small.png"/><meta content="text/html; charset=UTF-8" http-equiv="Content-Type"/><meta name="x-apple-disable-message-reformatting"/><title>Business Account Invitation</title><style>
    @font-face {
      font-family: 'Poppins';
      font-style: normal;
      font-weight: 400;
      mso-font-alt: 'Arial';
      src: url(https://fonts.gstatic.com/s/poppins/v27/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2) format('woff2');
    }

    * {
      font-family: 'Poppins', Arial;
    }
  </style><style>@media(min-width:768px){.md_px-84px{padding-left:84px !important;padding-right:84px !important}.md_pt-80px{padding-top:80px !important}.md_pb-40px{padding-bottom:40px !important}}@media(min-width:768px){.md_px-88px{padding-left:88px !important;padding-right:88px !important}.md_py-48px{padding-top:48px !important;padding-bottom:48px !important}}@media(min-width:768px){.md_text-center{text-align:center !important}}</style></head><body class="md_px-84px md_pt-80px md_pb-40px" style="margin-left:auto;margin-right:auto;margin-top:0px;margin-bottom:0px;background-color:rgb(244,244,244);font-family:ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;;min-height:100vh;padding-left:0px;padding-right:0px;padding-top:0px;padding-bottom:0px"><div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0" data-skip-in-text="true">You&#x27;ve been invited to ${org} on Pantheon<div>\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF</div></div><table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation"><tbody><tr><td><table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation"><tbody><tr><td></td></tr></tbody></table><table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation"><tbody><tr><td><table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="margin-left:auto;margin-right:auto;height:100%;max-width:600px;background-color:rgb(255,255,255)"><tbody><tr style="width:100%"><td><table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="padding-left:2rem;padding-right:2rem;padding-top:3rem;padding-bottom:3rem"><tbody><tr><td><table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="padding-bottom:0.5rem;z-index:10"><tbody><tr><td><table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="margin-left:auto;margin-right:auto;max-width:600px"><tbody style="width:100%"><tr style="width:100%"><td data-id="__react-email-column" style="width:20px;vertical-align:middle"><img alt="Pantheon" src="https://raw.githubusercontent.com/pantheon-systems/add-on-resources/main/k/pantheon-logo-small.png" style="display:block;outline:none;border:none;text-decoration:none" width="20"/></td><td data-id="__react-email-column" style="width:20px;text-align:center;vertical-align:middle"><span style="color:#CFCFD3">|</span></td><td data-id="__react-email-column" style="vertical-align:middle"><span style="font-weight:700;font-size:1.2rem">CONTENT PUBLISHER</span></td></tr></tbody></table></td></tr></tbody></table><h1 style="text-align:left;font-weight:700;font-size:27.56px;color:rgb(0,0,0);margin-bottom:2rem;line-height:120%">You&#x27;ve been invited as ${article}<br/>${roleLabel} for ${org}</h1><p style="font-size:16px;color:rgb(35,35,45);line-height:24px;margin-bottom:1.5rem;margin-top:16px">${inviter} has invited you to <strong>${org}</strong>.</p><a href="${link}" style="border-radius:0.25rem;background-color:rgb(79,50,206);padding-left:32px;padding-right:32px;padding-top:16px;padding-bottom:16px;text-align:center;font-weight:600;font-size:20px;color:rgb(255,255,255);text-decoration-line:none;display:inline-block;line-height:100%;text-decoration:none;max-width:100%;mso-padding-alt:0px" target="_blank"><span><!--[if mso]><i style="mso-font-width:400%;mso-text-raise:24" hidden>&#8202;&#8202;&#8202;&#8202;</i><![endif]--></span><span style="max-width:100%;display:inline-block;line-height:120%;mso-padding-alt:0px;mso-text-raise:12px">Go to Pantheon</span><span><!--[if mso]><i style="mso-font-width:400%" hidden>&#8202;&#8202;&#8202;&#8202;&#8203;</i><![endif]--></span></a></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table><table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation"><tbody><tr><td><table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" class="md_px-88px md_py-48px" style="background-color:rgb(255,255,255);margin-top:0.25rem;padding-top:1rem;padding-bottom:1rem;vertical-align:bottom;margin-left:auto;margin-right:auto;max-width:600px;padding-left:2rem;padding-right:2rem;height:200px"><tbody><tr><td><div style="width:100%"><p class="md_text-center" style="text-align:start;color:rgb(106,110,122);font-size:14px;line-height:20px;margin-top:0px;margin-bottom:0px">If you have any problems, please contact the Pantheon support team at helpdesk@pantheon.io.</p><p class="md_text-center" style="text-align:start;color:rgb(106,110,122);font-size:14px;line-height:20px;margin-top:0px;margin-bottom:0px">Pantheon systems, inc.</p><p class="md_text-center" style="text-align:start;color:rgb(106,110,122);font-size:14px;line-height:20px;margin-top:0px;margin-bottom:0px">717 California St., 3rd Fl. San Francisco, CA 94108</p></div></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></body></html>`;

  return { html, text };
}
