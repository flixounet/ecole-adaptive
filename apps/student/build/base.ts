export function normalizeBasePath(value: string | undefined): string {
  const base = value?.trim() || '/';
  if (
    !base.startsWith('/') ||
    !base.endsWith('/') ||
    base.includes('//') ||
    base.includes('\\') ||
    /[?#%]/.test(base) ||
    base.split('/').some((part) => part === '.' || part === '..') ||
    !/^[a-zA-Z0-9_./~-]+$/.test(base)
  ) {
    throw new Error(
      'VITE_BASE_PATH muss ein absoluter Pfad mit führendem und abschließendem / sein, z. B. /ecole/.',
    );
  }
  return base;
}
