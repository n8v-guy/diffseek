import {
  parseGitAttributes,
  type GitAttributeRule,
} from './gitattributes';
import type { RepositoryMetadata } from './metadata';

/**
 * Later lines win. Repository rules are parsed after this text, so a saved
 * .gitattributes overrides a built-in format or group without being rewritten.
 * Snapshot paths are cleared after the test rules: a `*.test.*` name inside a
 * snapshot still matches the test pattern, and the snapshot is generated output.
 */

const groupTests = 'group=Tests';
const groupDocs = 'group=Docs';
const groupConfig = 'group=Config';
const groupStyles = 'group=Styles';
const groupAssets = 'group=Assets';
const generatedFlag = 'linguist-generated';

type FormatSpec = {
  name: string;
  extensions: readonly string[];
  paths?: readonly string[];
  companions?: readonly string[];
  configs?: readonly string[];
  configOnly?: readonly string[];
  locks?: readonly string[];
  tests?: readonly string[];
  generated?: readonly string[];
};

const formats: readonly FormatSpec[] = [
  {
    name: 'TypeScript',
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    configs: ['**/tsconfig*.json'],
    generated: ['**/*.pb.ts', '**/*_pb.ts'],
  },
  {
    name: 'JavaScript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    configs: ['**/package.json', '**/jsconfig.json'],
    locks: ['**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml'],
  },
  {
    name: 'Python',
    extensions: ['.py', '.pyi', '.pyw'],
    configs: [
      '**/pyproject.toml',
      '**/setup.cfg',
      '**/tox.ini',
      '**/pytest.ini',
      '**/mypy.ini',
      '**/requirements*.txt',
      '**/Pipfile',
    ],
    configOnly: ['**/setup.py'],
    locks: ['**/Pipfile.lock', '**/poetry.lock'],
    tests: ['**/test_*.py', '**/*_test.py', '**/conftest.py'],
    generated: ['**/*_pb2.py', '**/*_pb2.pyi', '**/*_pb2_grpc.py'],
  },
  {
    name: 'Java',
    extensions: ['.java'],
    configs: ['**/pom.xml'],
    tests: ['**/*Test.java', '**/*Tests.java', '**/*IT.java', '**/*TestCase.java'],
  },
  {
    name: 'Kotlin',
    extensions: ['.kt', '.kts', '.ktm'],
    tests: ['**/*Test.kt', '**/*Tests.kt', '**/*Test.kts'],
  },
  {
    name: 'Gradle',
    extensions: [],
    configs: ['*.gradle', '*.gradle.kts'],
  },
  {
    name: 'C#',
    extensions: ['.cs', '.csx'],
    configs: ['**/*.csproj', '**/*.sln', '**/Directory.Build.props', '**/Directory.Build.targets'],
    tests: ['**/*Test.cs', '**/*Tests.cs', '**/*Test.csx'],
    generated: ['**/*.Designer.cs', '**/*.designer.cs'],
  },
  {
    name: 'C/C++',
    extensions: [
      '.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hh', '.hpp', '.hxx',
      '.h++', '.ipp', '.inl', '.tcc', '.tpp', '.txx', '.ixx', '.cppm', '.ino',
    ],
    configOnly: ['**/CMakeLists.txt', '**/Makefile', '**/meson.build'],
    tests: [
      '**/*_test.c', '**/*_test.cc', '**/*_test.cpp', '**/*_test.cxx',
      '**/*_test.h', '**/*_test.hpp', '**/*_unittest.cc', '**/*_unittest.cpp',
      '**/*Test.cpp', '**/*Test.cc',
    ],
    generated: ['**/*.pb.c', '**/*.pb.cc', '**/*.pb.cpp', '**/*.pb.h', '**/*.pb.hpp'],
  },
  {
    name: 'Go',
    extensions: ['.go', '.gohtml', '.gotmpl'],
    configs: ['**/go.mod', '**/go.work'],
    locks: ['**/go.sum'],
    tests: ['**/*_test.go'],
    generated: ['**/*.pb.go', '**/*.pb.gw.go', '**/zz_generated.*.go'],
  },
  {
    name: 'PHP',
    extensions: ['.php', '.php3', '.php4', '.php5', '.phps', '.phpt'],
    configs: [
      '**/composer.json',
      '**/phpunit.xml',
      '**/phpunit.xml.dist',
    ],
    locks: ['**/composer.lock'],
    tests: ['**/*Test.php', '**/*TestCase.php', '**/*.phpt'],
  },
  {
    name: 'Ruby',
    extensions: ['.rb', '.rake', '.gemspec', '.ru', '.rbi'],
    configs: ['**/Gemfile', '**/Rakefile'],
    locks: ['**/Gemfile.lock'],
    configOnly: ['**/*.gemspec'],
    tests: ['**/*_spec.rb', '**/*_test.rb'],
  },
  {
    name: 'Rust',
    extensions: ['.rs'],
    configs: ['**/Cargo.toml'],
    locks: ['**/Cargo.lock'],
    tests: ['**/*_test.rs', '**/*_tests.rs'],
  },
  {
    name: 'Swift',
    extensions: ['.swift'],
    configs: ['**/*.pbxproj'],
    configOnly: ['**/Package.swift'],
    tests: ['**/*Test.swift', '**/*Tests.swift'],
  },
  {
    name: 'Shell',
    extensions: ['.sh', '.bash', '.zsh', '.ksh', '.bats', '.command'],
    companions: ['**/gradlew'],
    configs: [
      '**/.bashrc',
      '**/.bash_profile',
      '**/.zshrc',
      '**/.zprofile',
      '**/.profile',
    ],
    tests: [
      '**/*_test.sh',
      '**/*_test.bash',
      '**/*_test.zsh',
      '**/test_*.sh',
      '**/test_*.bash',
      '**/*.bats',
    ],
  },
  {
    name: 'CSS',
    extensions: ['.css', '.scss', '.sass', '.less', '.styl', '.pcss', '.postcss', '.sss'],
    paths: ['*.css.ts', '*.css.tsx', '*.css.js', '*.css.jsx'],
    companions: ['**/styles/**/*.json', '**/style/**/*.json'],
    configs: [
      '**/tailwind.config.*',
      '**/postcss.config.*',
      '**/.stylelintrc',
      '**/.stylelintrc.*',
    ],
  },
  {
    name: 'HTML',
    extensions: [
      '.html', '.htm', '.xhtml', '.erb', '.rhtml', '.phtml', '.cshtml', '.razor',
      '.vue', '.svelte', '.twig', '.ejs', '.hbs', '.handlebars', '.mustache',
      '.jinja', '.jinja2', '.j2', '.pug', '.jade', '.liquid', '.njk', '.heex',
    ],
    paths: ['*.blade.php'],
  },
  {
    name: 'Dart',
    extensions: ['.dart'],
    configs: ['**/pubspec.yaml'],
    locks: ['**/pubspec.lock'],
    tests: ['**/*_test.dart'],
    generated: ['**/*.g.dart', '**/*.freezed.dart', '**/*.pb.dart', '**/*.pbjson.dart'],
  },
  {
    name: 'Astro',
    extensions: ['.astro'],
  },
  {
    name: 'Protobuf',
    extensions: ['.proto'],
  },
  {
    name: 'Terraform',
    extensions: ['.tf', '.tfvars'],
  },
];

const styleFolders = [
  '**/styles/**',
  '**/style/**',
  '**/css/**',
  '**/scss/**',
  '**/sass/**',
  '**/less/**',
];

const assetFolders = ['**/assets/**', '**/images/**', '**/img/**', '**/fonts/**'];

const docPatterns = ['docs/**', '**/*.md', '**/*.mdx'];

const genericConfig = [
  'config/**',
  '**/config/**',
  '**/*.config.*',
  '**/.eslintrc.*',
  '**/eslint.config.*',
  '.github/**',
];

const snapshotPatterns = ['**/*.snap', '**/__snapshots__/**'];

const generatedPatterns = [
  '**/vendor/**',
  '**/node_modules/**',
  '**/bower_components/**',
  '**/third_party/**',
  '**/third-party/**',
  '**/dist/**',
  '**/coverage/**',
  '**/generated/**',
  '**/__generated__/**',
  '**/gen/**',
  '**/out/**',
  '**/obj/**',
  '**/target/**',
  '**/bin/Debug/**',
  '**/bin/Release/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/Pods/**',
  '**/Carthage/Build/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.min.mjs',
  '**/*.generated.*',
  ...snapshotPatterns,
];

const testPatterns = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/*.e2e.*',
  '**/*-spec.*',
  '**/*.cy.ts',
  '**/*.cy.tsx',
  '**/*.cy.js',
  '**/*.cy.jsx',
  '**/test/**',
  '**/tests/**',
  '**/spec/**',
  '**/specs/**',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/__fixtures__/**',
  '**/testdata/**',
  '**/e2e/**',
  '**/unittest/**',
  '**/unittests/**',
  '**/Test/**',
  '**/androidTest/**',
  '**/commonTest/**',
  '**/jvmTest/**',
  '**/jsTest/**',
  '**/iosTest/**',
  '**/componentTest/**',
  '**/*Tests/**',
];

function languageOf(name: string): string {
  return `linguist-language=${name}`;
}

function pushLines(
  lines: string[],
  patterns: readonly string[] | undefined,
  assignment: string,
): void {
  for (const pattern of patterns ?? []) lines.push(`${pattern} ${assignment}`);
}

function renderBundledGitAttributes(specs: readonly FormatSpec[]): string {
  const lines: string[] = [];
  for (const spec of specs) {
    pushLines(lines, spec.extensions.map((ext) => `*${ext}`), languageOf(spec.name));
  }
  for (const spec of specs) pushLines(lines, spec.paths, languageOf(spec.name));
  for (const spec of specs) pushLines(lines, spec.companions, languageOf(spec.name));
  pushLines(lines, styleFolders, groupStyles);
  pushLines(lines, assetFolders, groupAssets);
  pushLines(lines, docPatterns, groupDocs);
  for (const spec of specs) {
    pushLines(lines, spec.configs, `${languageOf(spec.name)} ${groupConfig}`);
  }
  for (const spec of specs) pushLines(lines, spec.configOnly, groupConfig);
  pushLines(lines, genericConfig, groupConfig);
  pushLines(lines, generatedPatterns, generatedFlag);
  for (const spec of specs) pushLines(lines, spec.generated, generatedFlag);
  for (const spec of specs) {
    pushLines(lines, spec.locks, `${languageOf(spec.name)} ${generatedFlag}`);
  }
  pushLines(lines, testPatterns, groupTests);
  for (const spec of specs) pushLines(lines, spec.tests, groupTests);
  pushLines(lines, snapshotPatterns, '-group');
  return lines.join('\n');
}

export const bundledGitAttributes = renderBundledGitAttributes(formats);

export function rulesFromMetadata(
  metadata: Pick<RepositoryMetadata, 'attributes' | 'nestedAttributes'>,
): GitAttributeRule[] {
  return [
    ...parseGitAttributes(bundledGitAttributes),
    ...parseGitAttributes(metadata.attributes),
    ...nestedRules(metadata.nestedAttributes),
  ];
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
