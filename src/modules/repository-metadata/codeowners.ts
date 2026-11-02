import { globSource } from './glob';

const lineBreak = /\r?\n/v;
const rootSlash = /^\//v;
const trailingSlash = /\/$/v;
const whitespace = /\s+/v;
const wildcard = /[*?]/v;

export interface CodeownersRule {
  matcher: RegExp;
  owners: string[];
  pattern: string;
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
): null | string[] {
  let owners: null | string[] = null;
  for (const rule of rules) {
    if (rule.matcher.test(path)) owners = rule.owners;
  }
  return owners;
}

export function parseCodeowners(source: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const rawLine of source.split(lineBreak)) {
    const rule = codeownersRule(rawLine);
    if (rule !== null) rules.push(rule);
  }
  return rules;
}

function codeownersOwners(tokens: string[]): string[] {
  const comment = tokens.findIndex(
    (token, index) => index > 0 && token.startsWith('#'),
  );
  if (comment === -1) return tokens.slice(1);
  return tokens.slice(1, comment);
}

function codeownersRule(rawLine: string): CodeownersRule | null {
  const line = rawLine.trim();
  if (line.length === 0 || line.startsWith('#')) return null;
  const tokens = line.split(whitespace);
  const pattern = tokens[0] ?? '';
  if (isSkippedPattern(pattern)) return null;
  return {
    matcher: compilePattern(pattern),
    owners: codeownersOwners(tokens),
    pattern,
  };
}

function compilePattern(source: string): RegExp {
  const rootOnly = source.startsWith('/');
  const directory = source.endsWith('/');
  const pattern = source.replace(rootSlash, '').replace(trailingSlash, '');
  const containsSlash = pattern.includes('/');
  const finalSegment = pattern.split('/').at(-1) ?? '';
  const matchesDescendants =
    directory || (containsSlash && !wildcard.test(finalSegment));
  const prefix = rootOnly || containsSlash ? '^' : '(?:^|.*/)';
  const suffix = matchesDescendants ? '(?:/.*)?$' : '$';

  return new RegExp(`${prefix}${globSource(pattern)}${suffix}`);
}

function isSkippedPattern(pattern: string): boolean {
  return (
    pattern.length === 0 ||
    pattern.startsWith('!') ||
    pattern.startsWith('\\#') ||
    pattern.includes('[') ||
    pattern.includes(']')
  );
}
