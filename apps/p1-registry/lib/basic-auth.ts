export type Credentials = { user: string; password: string };

/**
 * Reads the catalog gate's credentials. Absent or blank values mean no gate at
 * all, so local dev, tests and CI keep running without any configuration.
 */
export function configuredCredentials(
  env: Record<string, string | undefined> = process.env,
): Credentials | null {
  const user = env.CATALOG_AUTH_USER?.trim();
  const password = env.CATALOG_AUTH_PASSWORD?.trim();
  return user && password ? { user, password } : null;
}

// Compares in time proportional to the input, not to how many characters match.
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export function isAuthorized(header: string | null, expected: Credentials): boolean {
  if (!header?.startsWith('Basic ')) return false;

  let decoded: string;
  try {
    decoded = atob(header.slice('Basic '.length).trim());
  } catch {
    return false;
  }

  // Only the first colon separates the pair; passwords may contain more.
  const separator = decoded.indexOf(':');
  if (separator === -1) return false;

  return (
    constantTimeEquals(decoded.slice(0, separator), expected.user) &&
    constantTimeEquals(decoded.slice(separator + 1), expected.password)
  );
}
