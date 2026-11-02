import { globSource } from './glob';

export type CodeownersRule = {
  pattern: string;
  owners: string[];
  matcher: RegExp;
};

export function parseCodeowners(source: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const tokens = line.split(/\s+/);
    const pattern = tokens[0] ?? '';
    if (
      !pattern ||
      pattern.startsWith('!') ||
      pattern.startsWith('\\#') ||
      pattern.includes('[') ||
      pattern.includes(']')
    ) {
      continue;
    }
    const comment = tokens.findIndex((token, index) => index > 0 && token.startsWith('#'));
    const owners =
      comment === -1 ? tokens.slice(1) : tokens.slice(1, comment);
    rules.push({ pattern, owners, matcher: compilePattern(pattern) });
  }

  return rules;
}

export function ownersForPath(
  path: string,
  rules: CodeownersRule[],
): string[] {
  return ownersForPathOrNull(path, rules) ?? [];
}

export function ownersForPathOrNull(
  path: string,
  rules: CodeownersRule[],
): string[] | null {
  let owners: string[] | null = null;
  for (const rule of rules) {
    if (rule.matcher.test(path)) owners = rule.owners;
  }
  return owners;
}

function compilePattern(source: string): RegExp {
  const rootOnly = source.startsWith('/');
  const directory = source.endsWith('/');
  const pattern = source.replace(/^\//, '').replace(/\/$/, '');
  const containsSlash = pattern.includes('/');
  const finalSegment = pattern.split('/').at(-1) ?? '';
  const matchesDescendants =
    directory || (containsSlash && !/[*?]/.test(finalSegment));
  const prefix = rootOnly || containsSlash ? '^' : '(?:^|.*/)';
  const suffix = matchesDescendants ? '(?:/.*)?$' : '$';

  return new RegExp(`${prefix}${globSource(pattern)}${suffix}`);
}
