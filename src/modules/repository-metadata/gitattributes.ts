import { globSource } from './glob';

const generatedAttribute = 'linguist-generated';
const languageAttribute = 'linguist-language';
const lineBreak = /\r?\n/v;
const rootSlash = /^\//v;
const whitespace = /\s/v;

export interface DiffSeekAttributes {
  generated: boolean;
  group: null | string;
  language: null | string;
}

export interface GitAttributeRule {
  assignments: Map<string, GitAttributeValue>;
  matcher: RegExp;
}

type GitAttributeValue = false | null | string | true;

const supported = new Set([
  generatedAttribute,
  'group',
  languageAttribute,
]);

export function attributesForPath(
  path: string,
  rules: GitAttributeRule[],
): DiffSeekAttributes {
  const values = new Map<string, GitAttributeValue>();
  for (const rule of rules) {
    if (!rule.matcher.test(path)) continue;
    for (const [name, value] of rule.assignments) values.set(name, value);
  }

  const group = values.get('group');
  const language = values.get(languageAttribute);
  const generated = values.get(generatedAttribute);
  return {
    generated:
      generated === true ||
      (typeof generated === 'string' &&
        generated.toLowerCase() === 'true'),
    group: typeof group === 'string' && group ? group : null,
    language: typeof language === 'string' && language ? language : null,
  };
}

export function parseGitAttributes(source: string): GitAttributeRule[] {
  const rules: GitAttributeRule[] = [];

  for (const rawLine of source.split(lineBreak)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const [pattern, ...attributes] = tokens(line);
    if (!isUsablePattern(pattern)) continue;

    const assignments = new Map<string, GitAttributeValue>();
    for (const attribute of attributes) {
      const [name, value] = assignment(attribute);
      if (supported.has(name)) assignments.set(name, value);
    }
    if (assignments.size > 0) {
      rules.push({ assignments, matcher: compilePattern(pattern) });
    }
  }

  return rules;
}

function assignment(token: string): [string, GitAttributeValue] {
  if (token.startsWith('-')) return [token.slice(1), false];
  if (token.startsWith('!')) return [token.slice(1), null];
  const separator = token.indexOf('=');
  return separator === -1
    ? [token, true]
    : [token.slice(0, separator), token.slice(separator + 1)];
}

function compilePattern(source: string): RegExp {
  const pattern = source.replace(rootSlash, '');
  const prefix = pattern.includes('/') ? '^' : '(?:^|.*/)';
  return new RegExp(`${prefix}${globSource(pattern)}$`);
}

function isUsablePattern(pattern: string | undefined): pattern is string {
  return (
    pattern !== undefined &&
    pattern.length > 0 &&
    !pattern.startsWith('!') &&
    !pattern.startsWith('[attr]')
  );
}

function tokens(line: string): string[] {
  const result: string[] = [];
  let token = '';
  let quote = false;
  let escaped = false;

  for (const character of line) {
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      quote = !quote;
    } else if (whitespace.test(character) && !quote) {
      if (token) result.push(token);
      token = '';
    } else {
      token += character;
    }
  }
  if (escaped) token += '\\';
  if (token) result.push(token);
  return result;
}
