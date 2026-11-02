import type { RedrawCounts } from './redraw-trace';

export type { RedrawCounts };

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
  coldTreeRebuilds: number;
  coldPanelRebuilds: number;
  warmTreeRebuilds: number;
  warmPanelRebuilds: number;
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

/** Shared cold/warm/hot panels cutoff: ceil(1.5x the pooled CI cold median over 5 runs). */
const panelsLimitSeconds = 16;

export function defaultLivePerfBudgets(
  env: NodeJS.ProcessEnv = process.env,
): LivePerfBudgets {
  return {
    coldFirstRenderSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_COLD_RENDER_S, 12),
    warmFirstRenderSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_WARM_RENDER_S, 10),
    hotFirstRenderSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_HOT_RENDER_S, 8),
    coldPanelsSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_COLD_PANELS_S, panelsLimitSeconds),
    warmPanelsSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_WARM_PANELS_S, panelsLimitSeconds),
    hotPanelsSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_HOT_PANELS_S, panelsLimitSeconds),
    menuOpenSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_MENU_S, 6),
    reconciles: numberEnv(env.DIFFSEEK_LIVE_BUDGET_RECONCILES, 500),
    domMutations: numberEnv(env.DIFFSEEK_LIVE_BUDGET_MUTATIONS, 12_000),
    actionReconciles: numberEnv(env.DIFFSEEK_LIVE_BUDGET_ACTION_RECONCILES, 40),
    treeRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_TREE_REBUILDS, 0),
    panelRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_PANEL_REBUILDS, 0),
    coldTreeRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_COLD_TREE_REBUILDS, 1),
    coldPanelRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_COLD_PANEL_REBUILDS, 1),
    warmTreeRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_WARM_TREE_REBUILDS, 1),
    warmPanelRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_WARM_PANEL_REBUILDS, 1),
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
 * Denominator-ready generated counter: total is known even when fresh-install
 * hiding leaves the visible numerator at 0.
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

export function medianSample(samples: readonly LivePerfSample[]): LivePerfSample {
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
    treeRowsReadded: median(samples.map((sample) => sample.treeRowsReadded)),
    panelsReadded: median(samples.map((sample) => sample.panelsReadded)),
    treeNetLoss: median(samples.map((sample) => sample.treeNetLoss)),
    panelNetLoss: median(samples.map((sample) => sample.panelNetLoss)),
  };
}

export function actionFailures(
  action: string,
  counts: RedrawCounts,
  budgets: LivePerfBudgets,
): string[] {
  const failures = rebuildFailures(
    { ...counts, scenario: 'hot', firstRenderSeconds: 0, menuOpenSeconds: 0, panelsSeconds: 0 },
    budgets,
  ).map((failure) => failure.replace('hot ', `${action} `));
  if (counts.reconciles > budgets.actionReconciles) {
    failures.push(
      `${action} reconciles ${counts.reconciles} > ${budgets.actionReconciles}`,
    );
  }
  return failures;
}

/**
 * Rebuilds stay at or under the scenario cap. Cold and warm leave room for a
 * GitHub load redraw without requiring that exact count. Actions use the
 * tighter caps.
 */
export function rebuildFailures(
  sample: LivePerfSample,
  budgets: LivePerfBudgets,
): string[] {
  const failures: string[] = [];
  if (sample.scenario === 'cold' || sample.scenario === 'warm') {
    const cold = sample.scenario === 'cold';
    const tree = cold ? budgets.coldTreeRebuilds : budgets.warmTreeRebuilds;
    const panel = cold ? budgets.coldPanelRebuilds : budgets.warmPanelRebuilds;
    if (sample.treeRebuilds > tree) {
      failures.push(`${sample.scenario} treeRebuilds ${sample.treeRebuilds} > ${tree}`);
    }
    if (sample.panelRebuilds > panel) {
      failures.push(`${sample.scenario} panelRebuilds ${sample.panelRebuilds} > ${panel}`);
    }
    return failures;
  }
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

/** Hot navigation churns GitHub's own panels. Fail only when rows stay gone. */
export function hotLossFailures(sample: LivePerfSample): string[] {
  const failures: string[] = [];
  if (sample.treeNetLoss > 0) {
    failures.push(`hot treeNetLoss ${sample.treeNetLoss} > 0`);
  }
  if (sample.panelNetLoss > 0) {
    failures.push(`hot panelNetLoss ${sample.panelNetLoss} > 0`);
  }
  return failures;
}

/** Median timings and redraw volume. Durations are noisy; rebuilds are not. */
export function medianBudgetFailures(
  samples: readonly LivePerfSample[],
  budgets: LivePerfBudgets,
): string[] {
  if (samples.length === 0) return ['no samples'];
  const sample = medianSample(samples);
  const failures: string[] = [];
  const renderBudget = {
    cold: budgets.coldFirstRenderSeconds,
    warm: budgets.warmFirstRenderSeconds,
    hot: budgets.hotFirstRenderSeconds,
  }[sample.scenario];
  const panelsBudget = {
    cold: budgets.coldPanelsSeconds,
    warm: budgets.warmPanelsSeconds,
    hot: budgets.hotPanelsSeconds,
  }[sample.scenario];
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
    return `| ${scenario} | ${medianRow.firstRenderSeconds} | ${medianRow.menuOpenSeconds} | ${medianRow.panelsSeconds} | ${medianRow.reconciles} | ${medianRow.domMutations} | ${medianRow.treeRebuilds} | ${medianRow.panelRebuilds} | ${medianRow.treeRowsRemoved} | ${medianRow.treeRowsReadded} | ${medianRow.panelsRemoved} | ${medianRow.panelsReadded} | ${medianRow.treeNetLoss} | ${medianRow.panelNetLoss} |`;
  });
  return [
    `### DiffSeek live performance`,
    '',
    report.prUrl,
    '',
    '| scenario | first render s | menu s | panels s | reconciles | DOM mutations | tree rebuilds | panel rebuilds | tree removed | tree re-added | panels removed | panels re-added | tree net loss | panel net loss |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    'Durations are medians. Cold and warm tree rebuilds and diff-panel rebuilds must stay within their caps (a GitHub load redraw may be present or absent). Hot ignores mass removal and fails only when a row removed after the first DiffSeek control is still gone 500 ms later.',
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
  const parsed: CookieLike = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
  };
  if (typeof cookie.path === 'string') parsed.path = cookie.path;
  if (typeof cookie.expires === 'number') parsed.expires = cookie.expires;
  if (typeof cookie.httpOnly === 'boolean') parsed.httpOnly = cookie.httpOnly;
  if (typeof cookie.secure === 'boolean') parsed.secure = cookie.secure;
  if (
    cookie.sameSite === 'Strict' ||
    cookie.sameSite === 'Lax' ||
    cookie.sameSite === 'None'
  ) {
    parsed.sameSite = cookie.sameSite;
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
