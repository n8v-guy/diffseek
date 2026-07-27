type GitAttributeValue = true | false | string | null;

export type GitAttributeRule = {
  matcher: RegExp;
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

export function parseGitAttributes(source: string): GitAttributeRule[] {
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
      rules.push({ matcher: compilePattern(pattern), assignments });
    }
  }

  return rules;
}

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

function compilePattern(source: string): RegExp {
  const pattern = source.replace(/^\//, '');
  const prefix = pattern.includes('/') ? '^' : '(?:^|.*/)';
  return new RegExp(`${prefix}${globSource(pattern)}$`);
}

function globSource(pattern: string): string {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character?.replace(/[|\\{}()[\]^$+?.]/g, '\\$&') ?? '';
    }
  }
  return source;
}
