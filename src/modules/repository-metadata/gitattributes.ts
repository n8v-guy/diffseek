import { globSource } from './glob';

type GitAttributeValue = true | false | string | null;

export type GitAttributeRule = {
  matcher: { test(path: string, name: string): boolean };
  assignments: Map<string, GitAttributeValue>;
};

export type DiffSeekAttributes = {
  group: string | null;
  language: string | null;
  generated: boolean;
};

const supported = new Set([
  'group',
  'linguist-language',
  'linguist-generated',
]);

export function parseGitAttributes(
  source: string,
  directory = '',
): GitAttributeRule[] {
  const rules: GitAttributeRule[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const [pattern, ...attributes] = tokens(line);
    if (!pattern || pattern.startsWith('!') || pattern.startsWith('[attr]')) {
      continue;
    }

    const assignments = new Map<string, GitAttributeValue>();
    for (const attribute of attributes) {
      const [name, value] = assignment(attribute);
      if (supported.has(name)) assignments.set(name, value);
    }
    if (assignments.size > 0) {
      rules.push({ matcher: compilePattern(pattern, directory), assignments });
    }
  }

  return rules;
}

export function attributesForPath(
  path: string,
  rules: GitAttributeRule[],
): DiffSeekAttributes {
  const baseName = basename(path);
  const values = new Map<string, GitAttributeValue>();
  for (const rule of rules) {
    if (!rule.matcher.test(path, baseName)) continue;
    for (const [name, value] of rule.assignments) values.set(name, value);
  }

  const group = values.get('group');
  const language = values.get('linguist-language');
  const generated = values.get('linguist-generated');
  return {
    group: typeof group === 'string' && group ? group : null,
    language: typeof language === 'string' && language ? language : null,
    generated:
      generated === true ||
      (typeof generated === 'string' &&
        generated.toLowerCase() === 'true'),
  };
}

function assignment(token: string): [string, GitAttributeValue] {
  if (token.startsWith('-')) return [token.slice(1), false];
  if (token.startsWith('!')) return [token.slice(1), null];
  const separator = token.indexOf('=');
  return separator === -1
    ? [token, true]
    : [token.slice(0, separator), token.slice(separator + 1)];
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
    } else if (/\s/.test(character) && !quote) {
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

const nestedGlob = '**/';
const slash = '/';

function compilePattern(
  source: string,
  directory: string,
): { test(path: string, name: string): boolean } {
  // Extension and exact-name rules are most of the built-in list. A suffix
  // check skips compiling a regex and running it on every file.
  const fast = directory === '' ? filenameMatcher(source) : null;
  if (fast !== null) return fast;
  const pattern = source.replace(/^\//, '');
  const scope = directory
    ? `${directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${slash}`
    : '';
  const prefix = source.includes(slash) ? '' : '(?:.*/)?';
  const expression = new RegExp(`^${scope}${prefix}${globSource(pattern)}$`);
  return { test: (path) => expression.test(path) };
}

function filenameMatcher(
  source: string,
): { test(path: string, name: string): boolean } | null {
  if (source.startsWith(slash)) return null;
  let pattern = source;
  if (pattern.startsWith(nestedGlob)) {
    pattern = pattern.slice(nestedGlob.length);
  }
  if (pattern === '' || pattern.includes(slash) || pattern.includes('?')) {
    return null;
  }
  const star = pattern.indexOf('*');
  if (star === -1) return { test: (_path, name) => name === pattern };
  if (star !== 0 || pattern.includes('*', 1)) return null;
  const suffix = pattern.slice(1);
  if (suffix === '') return null;
  return { test: (_path, name) => name.endsWith(suffix) };
}

function basename(path: string): string {
  const split = path.lastIndexOf(slash);
  return split === -1 ? path : path.slice(split + 1);
}
