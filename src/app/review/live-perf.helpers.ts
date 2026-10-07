/** Live DiffSeek performance defaults for sha-tm/diffseek-test-data#1 (seed 185108). */
export const defaultLivePrUrl =
  'https://github.com/sha-tm/diffseek-test-data/pull/1/changes?new_files_changed=true';

/** Seed `185108` fixture tree marks exactly this many files generated. */
export const expectedGeneratedTotal = 86;

/**
 * Cold/warm `indexingSeconds` ends when the catalog has the full file list and
 * every non-viewed facet is classified. Viewed-state settle is out of scope.
 */
export type LivePerfScenario = 'cold' | 'warm' | 'mark-generated-viewed';

export type LivePerfMetrics = {
  indexingSeconds: number;
  menuOpenSeconds: number;
  networkRequests: number;
  networkUrls: string[];
  redraws: number;
  scenario: LivePerfScenario;
};

export type LivePerfBudgets = {
  indexingSeconds: number;
  markSeconds: number;
  menuOpenSeconds: number;
  networkRequests: number;
  redraws: number;
};

export type CookieLike = {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

export function defaultLivePerfBudgets(
  env: NodeJS.ProcessEnv = process.env,
): LivePerfBudgets {
  return {
    indexingSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_INDEX_S, 120),
    markSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_MARK_S, 180),
    menuOpenSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_MENU_S, 15),
    networkRequests: numberEnv(env.DIFFSEEK_LIVE_BUDGET_NETWORK, 40),
    redraws: numberEnv(env.DIFFSEEK_LIVE_BUDGET_REDRAWS, 2_000),
  };
}

export function isExtensionMetadataRequest(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (
    parsed.hostname !== 'github.com' &&
    parsed.hostname !== 'raw.githubusercontent.com'
  ) {
    return false;
  }
  if (/\/pull\/\d+\/commits\/?$/.test(parsed.pathname)) return true;
  return (
    parsed.pathname.endsWith('/.gitattributes') ||
    parsed.pathname.endsWith('/CODEOWNERS')
  );
}

/** Generated facet shows visible/total; fully indexed + unfiltered is N/N. */
export function generatedIndexedText(total: number): string {
  return `${total}/${total}`;
}

/**
 * Denominator-ready generated counter: total is known even if viewed hiding
 * shrinks the visible numerator.
 */
export function generatedCategorizedPattern(total: number): RegExp {
  return new RegExp(`^\\d+/${total}$`);
}

/** True when a `visible/total` counter's denominator matches `total`. */
export function isGeneratedCategorized(
  text: string | null | undefined,
  total: number,
): boolean {
  return generatedCategorizedPattern(total).test(text?.trim() ?? '');
}

export function assertWithinBudgets(
  metrics: LivePerfMetrics,
  budgets: LivePerfBudgets,
): string[] {
  const failures: string[] = [];
  if (metrics.menuOpenSeconds > budgets.menuOpenSeconds) {
    failures.push(
      `menuOpenSeconds ${metrics.menuOpenSeconds} > ${budgets.menuOpenSeconds}`,
    );
  }
  const actionBudget =
    metrics.scenario === 'mark-generated-viewed'
      ? budgets.markSeconds
      : budgets.indexingSeconds;
  if (metrics.indexingSeconds > actionBudget) {
    failures.push(
      `indexingSeconds ${metrics.indexingSeconds} > ${actionBudget}`,
    );
  }
  if (metrics.redraws > budgets.redraws) {
    failures.push(`redraws ${metrics.redraws} > ${budgets.redraws}`);
  }
  if (
    metrics.scenario === 'cold' &&
    metrics.networkRequests > budgets.networkRequests
  ) {
    failures.push(
      `networkRequests ${metrics.networkRequests} > ${budgets.networkRequests}`,
    );
  }
  return failures;
}

export function parseStorageCookies(raw: unknown): CookieLike[] {
  if (!isRecord(raw) || !Array.isArray(raw.cookies)) {
    throw new Error('storageState JSON must include a cookies array');
  }
  return raw.cookies.map((cookie, index) => readCookie(cookie, index));
}

/** Cursor/GitHub secrets inject JSON; local runs usually pass a file path. */
export function isInlineStorageState(source: string): boolean {
  return source.trimStart().startsWith('{');
}

export function parseInlineStorageState(source: string): unknown {
  return JSON.parse(source);
}

function readCookie(cookie: unknown, index: number): CookieLike {
  if (!isRecord(cookie)) {
    throw new Error(`storageState cookies[${index}] is invalid`);
  }
  if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string') {
    throw new Error(`storageState cookies[${index}] is missing name/value`);
  }
  if (typeof cookie.domain !== 'string') {
    throw new Error(`storageState cookies[${index}] is missing domain`);
  }
  const sameSite = cookie.sameSite;
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: typeof cookie.path === 'string' ? cookie.path : undefined,
    expires: typeof cookie.expires === 'number' ? cookie.expires : undefined,
    httpOnly: typeof cookie.httpOnly === 'boolean' ? cookie.httpOnly : undefined,
    secure: typeof cookie.secure === 'boolean' ? cookie.secure : undefined,
    sameSite:
      sameSite === 'Strict' || sameSite === 'Lax' || sameSite === 'None'
        ? sameSite
        : undefined,
  };
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
