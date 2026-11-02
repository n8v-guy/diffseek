import {
  TEST_SUFFIXES,
  TYPESCRIPT_SOURCE_ROOTS,
} from '../config/project.config.ts';

const layerSplitLimit = 2;
const planningPrefix = 'docs/superpowers/';
const playwrightSuffix = '.e2e.playwright.ts';
const sourceLayers = new Set(['adapters', 'app', 'modules']);
const testLikePattern =
  /\.(?:tests?|specs?|unit|e2e(?:\.playwright)?)\.tsx?$/v;

export function findStructureViolations(paths: string[]): string[] {
  const violations: string[] = [];
  const knownPaths = new Set(paths);
  for (const filePath of paths) {
    const violation = violationFor(filePath, knownPaths);
    if (violation !== undefined) violations.push(violation);
  }
  return violations.toSorted((left, right) => left.localeCompare(right));
}

function isSourceRoot(
  value: string,
): value is (typeof TYPESCRIPT_SOURCE_ROOTS)[number] {
  return TYPESCRIPT_SOURCE_ROOTS.some((root) => root === value);
}

function namesakeViolation(
  filePath: string,
  knownPaths: Set<string>,
): string | undefined {
  if (!filePath.startsWith('src/') && !filePath.startsWith('scripts/')) {
    return undefined;
  }
  const suffix = TEST_SUFFIXES.find((candidate) => filePath.endsWith(candidate));
  if (suffix === undefined || suffix === playwrightSuffix) return undefined;
  const source = `${filePath.slice(0, -suffix.length)}.ts`;
  if (knownPaths.has(source)) return undefined;
  return `${filePath}: missing namesake module ${source}`;
}

function sourceLayerViolation(filePath: string): string | undefined {
  if (!filePath.startsWith('src/')) return undefined;
  const layer = filePath.split('/', layerSplitLimit)[1] ?? '';
  if (sourceLayers.has(layer)) return undefined;
  return `${filePath}: source is outside an architectural layer`;
}

function sourceRootViolation(filePath: string): string | undefined {
  const [root] = filePath.split('/', 1);
  if (root !== undefined && isSourceRoot(root)) return undefined;
  return `${filePath}: TypeScript is outside configured roots`;
}

function testSuffixViolation(filePath: string): string | undefined {
  const knownSuffix = TEST_SUFFIXES.some((suffix) => filePath.endsWith(suffix));
  if (!testLikePattern.test(filePath) || knownSuffix) return undefined;
  return `${filePath}: unsupported test suffix`;
}

function typescriptViolation(
  filePath: string,
  knownPaths: Set<string>,
): string | undefined {
  return (
    sourceLayerViolation(filePath) ??
    sourceRootViolation(filePath) ??
    testSuffixViolation(filePath) ??
    namesakeViolation(filePath, knownPaths)
  );
}

function violationFor(
  filePath: string,
  knownPaths: Set<string>,
): string | undefined {
  if (filePath.startsWith(planningPrefix)) {
    return `${filePath}: generated planning artifact is tracked`;
  }
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return undefined;
  return typescriptViolation(filePath, knownPaths);
}
