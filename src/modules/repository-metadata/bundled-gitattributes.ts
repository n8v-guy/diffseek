import {
  parseGitAttributes,
  type GitAttributeRule,
} from './gitattributes';
import type { RepositoryMetadata } from './metadata';

/**
 * Built-ins apply only when the repository defines no group or language.
 * Generated marks are not that guidance: they still apply after the built-ins,
 * and a later line still wins. A repository that sets a group or language is
 * used alone.
 */

const languageAttribute = 'linguist-language';
const groupAttribute = 'group';
const generatedAttribute = 'linguist-generated';

type Format = {
  name: string;
  extensions: readonly string[];
};

const formats: readonly Format[] = [
  { name: 'TypeScript', extensions: ['.ts', '.tsx'] },
  { name: 'JavaScript', extensions: ['.js', '.jsx', '.mjs', '.cjs'] },
  { name: 'C/C++', extensions: ['.c', '.cc', '.cpp', '.h', '.hpp'] },
  { name: 'Kotlin', extensions: ['.kt', '.kts'] },
  { name: 'CSS', extensions: ['.css', '.scss'] },
];

const docPatterns = ['docs/**', '**/*.md', '**/*.mdx'];

const configPatterns = [
  '**/config/**',
  '**/*.config.*',
  '**/tsconfig*.json',
  '**/.eslintrc.*',
  '.github/**',
  '**/package.json',
  '**/pyproject.toml',
  '**/requirements*.txt',
  '**/go.mod',
  '**/Cargo.toml',
  '**/pom.xml',
  '**/*.gradle',
  '**/*.gradle.kts',
  '**/composer.json',
  '**/Gemfile',
  '**/pubspec.yaml',
  '**/*.csproj',
  '**/*.sln',
  '**/CMakeLists.txt',
  '**/Makefile',
];

const snapshotPatterns = ['**/*.snap', '**/__snapshots__/**'];

const generatedPatterns = [
  '**/node_modules/**',
  '**/vendor/**',
  '**/dist/**',
  '**/coverage/**',
  '**/generated/**',
  '**/__generated__/**',
  '**/target/**',
  '**/third_party/**',
  '**/.next/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/poetry.lock',
  '**/composer.lock',
  '**/Gemfile.lock',
  '**/Cargo.lock',
  '**/go.sum',
  '**/pubspec.lock',
  '**/*.g.dart',
  '**/*.freezed.dart',
  ...snapshotPatterns,
];

const testPatterns = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/*.e2e.*',
  '**/test/**',
  '**/tests/**',
  '**/spec/**',
  '**/__tests__/**',
  '**/e2e/**',
  '**/androidTest/**',
  '**/*_test.go',
  '**/test_*.py',
  '**/*_test.py',
  '**/*Tests/**',
];

function renderDefaults(): string {
  const lines: string[] = [];
  for (const format of formats) {
    const language = `${languageAttribute}=${format.name}`;
    for (const extension of format.extensions) {
      lines.push(`*${extension} ${language}`);
    }
  }
  pushLines(lines, docPatterns, `${groupAttribute}=Docs`);
  pushLines(lines, configPatterns, `${groupAttribute}=Config`);
  pushLines(lines, generatedPatterns, generatedAttribute);
  pushLines(lines, testPatterns, `${groupAttribute}=Tests`);
  pushLines(lines, snapshotPatterns, `-${groupAttribute}`);
  return lines.join('\n');
}

function pushLines(
  lines: string[],
  patterns: readonly string[],
  assignment: string,
): void {
  for (const pattern of patterns) lines.push(`${pattern} ${assignment}`);
}

const defaultRules = parseGitAttributes(renderDefaults());

export function rulesFromMetadata(
  metadata: Pick<RepositoryMetadata, 'attributes' | 'nestedAttributes'>,
): GitAttributeRule[] {
  const repository = [
    ...parseGitAttributes(metadata.attributes),
    ...nestedRules(metadata.nestedAttributes),
  ];
  if (hasGuidance(repository)) return repository;
  return repository.length === 0
    ? defaultRules
    : [...defaultRules, ...repository];
}

function hasGuidance(rules: readonly GitAttributeRule[]): boolean {
  return rules.some(
    (rule) =>
      rule.assignments.has(groupAttribute) ||
      rule.assignments.has(languageAttribute),
  );
}

function nestedRules(
  nested: RepositoryMetadata['nestedAttributes'],
): GitAttributeRule[] {
  return Object.entries(nested ?? {})
    .sort(
      ([left], [right]) => left.split('/').length - right.split('/').length,
    )
    .flatMap(([directory, source]) => parseGitAttributes(source, directory));
}
