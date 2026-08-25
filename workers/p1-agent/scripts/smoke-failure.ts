/**
 * Shared failure reporting for the on-demand gateway smoke scripts. Nothing here runs in the
 * worker; it exists so a smoke run explains itself instead of printing a bare stack.
 *
 * The case worth naming: a partner model the account cannot bill answers with
 * `404 not_found_error`, which reads as a wrong model id or a broken URL join. It is neither.
 * Partner providers need the gateway's Unified Billing enabled and funded before any of their
 * ids resolve, so the fix is an account action rather than a code change.
 */

/** Workers AI ids are billed to the account directly; everything else is a partner provider. */
export function isPartnerModel(model: string): boolean {
  return !model.startsWith('@cf/');
}

function isNotFound(err: unknown): boolean {
  const e = err as { status?: number; error?: { error?: { type?: string } } };
  return e.status === 404 || e.error?.error?.type === 'not_found_error';
}

/** Print why the call failed and exit non-zero. */
export function reportGatewayFailure(err: unknown, model: string): never {
  if (isNotFound(err) && isPartnerModel(model)) {
    console.error(`\n❌ "${model}" is not available on this gateway.`);
    console.error(
      '   Partner models bill through the AI Gateway\'s Unified Billing, which must be enabled\n' +
      '   and funded on the gateway before any anthropic/*, openai/* or google-ai-studio/* id\n' +
      '   resolves. That is an account action, not a code change.',
    );
    process.exit(1);
  }

  console.error('\n❌ Smoke test errored:', err instanceof Error ? err.message : err);
  // Both SDK error types expose status/url; the body often names the exact cause.
  const e = err as { status?: number; url?: string; error?: unknown };
  if (e.status !== undefined) console.error('  status:', e.status);
  if (e.url) console.error('  url:', e.url);
  if (e.error) console.error('  body:', JSON.stringify(e.error));
  console.error('  401 -> token/auth; 400 -> model id or message shape; 404 -> REST URL join.');
  process.exit(1);
}
