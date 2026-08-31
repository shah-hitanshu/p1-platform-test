export function normalizePath(path: string): string {
  if (path.startsWith('/')) {
    return path
      .slice(1)
      .split('/')
      .join('.');
  }
  return path.replace(/^\.+/, '');
}
