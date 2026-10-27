/** Live DiffSeek performance defaults for sha-tm/diffseek-test-data#1 (seed 185108). */
export const defaultLivePrUrl =
  'https://github.com/sha-tm/diffseek-test-data/pull/1/changes?new_files_changed=true';

/** Seed `185108` fixture tree marks exactly this many files generated. */
export const expectedGeneratedTotal = 86;

/**
 * Cold is a first load with an empty extension cache. Warm is a reload.
 * Hot is an in-page navigation back to the files view. `panelsSeconds` ends
 * when the catalog has the full file list and every non-viewed facet is
 * classified. Viewed-state settle is out of scope.
 */
export type LivePerfScenario = 'cold' | 'warm' | 'hot';

export type RedrawCounts = {
  reconciles: number;
  domMutations: number;
  treeRebuilds: number;
  panelRebuilds: number;
  treeRowsRemoved: number;
  panelsRemoved: number;
};

export type LivePerfSample = RedrawCounts & {
  scenario: LivePerfScenario;
  firstRenderSeconds: number;
  menuOpenSeconds: number;
  panelsSeconds: number;
};

export type LivePerfBudgets = {
  coldFirstRenderSeconds: number;
  warmFirstRenderSeconds: number;
  hotFirstRenderSeconds: number;
  coldPanelsSeconds: number;
  warmPanelsSeconds: number;
  hotPanelsSeconds: number;
  menuOpenSeconds: number;
  reconciles: number;
  domMutations: number;
  actionReconciles: number;
  treeRebuilds: number;
  panelRebuilds: number;
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
    coldFirstRenderSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_COLD_RENDER_S, 45),
    warmFirstRenderSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_WARM_RENDER_S, 30),
    hotFirstRenderSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_HOT_RENDER_S, 20),
    coldPanelsSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_COLD_PANELS_S, 90),
    warmPanelsSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_WARM_PANELS_S, 60),
    hotPanelsSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_HOT_PANELS_S, 45),
    menuOpenSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_MENU_S, 12),
    reconciles: numberEnv(env.DIFFSEEK_LIVE_BUDGET_RECONCILES, 500),
    domMutations: numberEnv(env.DIFFSEEK_LIVE_BUDGET_MUTATIONS, 12_000),
    actionReconciles: numberEnv(env.DIFFSEEK_LIVE_BUDGET_ACTION_RECONCILES, 40),
    treeRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_TREE_REBUILDS, 0),
    panelRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_PANEL_REBUILDS, 0),
  };
}

export function liveSampleCount(env: NodeJS.ProcessEnv = process.env): number {
  return Math.max(1, Math.floor(numberEnv(env.DIFFSEEK_LIVE_SAMPLES, 3)));
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

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[mid - 1] ?? 0;
  return Number(((lower + upper) / 2).toFixed(3));
}

export function medianSample(samples: LivePerfSample[]): LivePerfSample {
  const scenario = samples[0]?.scenario ?? 'cold';
  return {
    scenario,
    firstRenderSeconds: median(samples.map((sample) => sample.firstRenderSeconds)),
    menuOpenSeconds: median(samples.map((sample) => sample.menuOpenSeconds)),
    panelsSeconds: median(samples.map((sample) => sample.panelsSeconds)),
    reconciles: median(samples.map((sample) => sample.reconciles)),
    domMutations: median(samples.map((sample) => sample.domMutations)),
    treeRebuilds: median(samples.map((sample) => sample.treeRebuilds)),
    panelRebuilds: median(samples.map((sample) => sample.panelRebuilds)),
    treeRowsRemoved: median(samples.map((sample) => sample.treeRowsRemoved)),
    panelsRemoved: median(samples.map((sample) => sample.panelsRemoved)),
  };
}

export function actionFailures(
  action: string,
  counts: RedrawCounts,
  budgets: LivePerfBudgets,
): string[] {
  const failures = rebuildFailures(
    { ...counts, scenario: 'cold', firstRenderSeconds: 0, menuOpenSeconds: 0, panelsSeconds: 0 },
    budgets,
  ).map((failure) => failure.replace('cold ', `${action} `));
  if (counts.reconciles > budgets.actionReconciles) {
    failures.push(
      `${action} reconciles ${counts.reconciles} > ${budgets.actionReconciles}`,
    );
  }
  return failures;
}

/** Every run must stay at or under the rebuild caps. One rebuild fails the job. */
export function rebuildFailures(
  sample: LivePerfSample,
  budgets: LivePerfBudgets,
): string[] {
  const failures: string[] = [];
  if (sample.treeRebuilds > budgets.treeRebuilds) {
    failures.push(
      `${sample.scenario} treeRebuilds ${sample.treeRebuilds} > ${budgets.treeRebuilds}`,
    );
  }
  if (sample.panelRebuilds > budgets.panelRebuilds) {
    failures.push(
      `${sample.scenario} panelRebuilds ${sample.panelRebuilds} > ${budgets.panelRebuilds}`,
    );
  }
  return failures;
}

/** Median timings and redraw volume. Durations are noisy; rebuilds are not. */
export function medianBudgetFailures(
  sample: LivePerfSample,
  budgets: LivePerfBudgets,
): string[] {
  const failures: string[] = [];
  const renderBudget =
    sample.scenario === 'cold'
      ? budgets.coldFirstRenderSeconds
      : sample.scenario === 'warm'
        ? budgets.warmFirstRenderSeconds
        : budgets.hotFirstRenderSeconds;
  const panelsBudget =
    sample.scenario === 'cold'
      ? budgets.coldPanelsSeconds
      : sample.scenario === 'warm'
        ? budgets.warmPanelsSeconds
        : budgets.hotPanelsSeconds;
  if (sample.firstRenderSeconds > renderBudget) {
    failures.push(
      `${sample.scenario} firstRenderSeconds ${sample.firstRenderSeconds} > ${renderBudget}`,
    );
  }
  if (sample.menuOpenSeconds > budgets.menuOpenSeconds) {
    failures.push(
      `${sample.scenario} menuOpenSeconds ${sample.menuOpenSeconds} > ${budgets.menuOpenSeconds}`,
    );
  }
  if (sample.panelsSeconds > panelsBudget) {
    failures.push(
      `${sample.scenario} panelsSeconds ${sample.panelsSeconds} > ${panelsBudget}`,
    );
  }
  if (sample.reconciles > budgets.reconciles) {
    failures.push(
      `${sample.scenario} reconciles ${sample.reconciles} > ${budgets.reconciles}`,
    );
  }
  if (sample.domMutations > budgets.domMutations) {
    failures.push(
      `${sample.scenario} domMutations ${sample.domMutations} > ${budgets.domMutations}`,
    );
  }
  return failures;
}

export function livePerfSummary(report: {
  prUrl: string;
  cold: LivePerfSample[];
  warm: LivePerfSample[];
  hot: LivePerfSample[];
}): string {
  const rows = (['cold', 'warm', 'hot'] as const).map((scenario) => {
    const medianRow = medianSample(report[scenario]);
    return `| ${scenario} | ${medianRow.firstRenderSeconds} | ${medianRow.menuOpenSeconds} | ${medianRow.panelsSeconds} | ${medianRow.reconciles} | ${medianRow.domMutations} | ${medianRow.treeRebuilds} | ${medianRow.panelRebuilds} |`;
  });
  return [
    `### DiffSeek live performance`,
    '',
    report.prUrl,
    '',
    '| scenario | first render s | menu s | panels s | reconciles | DOM mutations | tree rebuilds | panel rebuilds |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    'Durations are medians. Tree and diff-panel rebuilds must stay at 0 on every run.',
    '',
  ].join('\n');
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
