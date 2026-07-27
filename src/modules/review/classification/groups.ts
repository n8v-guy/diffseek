export function extensionOf(path: string): string | null {
  const name = path.split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');

  return dot > 0 ? name.slice(dot).toLowerCase() : null;
}
