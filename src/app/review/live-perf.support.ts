import type { RedrawCounts } from './redraw-trace';

export type { RedrawCounts };

/** Live DiffSeek performance defaults for sha-tm/diffseek-test-data#1 (seed 185108). */
export const defaultLivePrUrl =
  'https://github.com/sha-tm/diffseek-test-data/pull/1/changes?new_files_changed=true';

/** Deleted `neutral/.gitattributes` still matches tip `neutral/** linguist-generated`. */
export const expectedGeneratedTotal = 87;

/**
 * Cold is a first load with an empty extension cache. Warm is a reload.
 * Hot is an in-page navigation back to the files view. `panelsSeconds` ends
 * when the catalog has the full file list and every non-viewed facet is
 * classified. Viewed-state settle is out of scope, except in the loads below.
 * Cold-mark is cold with the fresh-install defaults, so auto-view marks the
 * generated files viewed; it ends when they all are. Unmark starts at a click
 * on the generated count and ends when they are all unmarked. Restored starts
 * at a click on the pull in the repository's list, from filters set on the
 * hot load, and ends like hot with those filters back.
 */
export const livePerfScenarios = ['cold', 'warm', 'hot', 'coldMark', 'unmark', 'restored'] as const;

export type LivePerfScenario = (typeof livePerfScenarios)[number];

type ScenarioLimits = {
  firstRenderSeconds: number;
  menuOpenSeconds: number;
  panelsSeconds: number;
  reconciles: number;
  domMutations: number;
  treeRebuilds: number;
  panelRebuilds: number;
};

type LimitedScenario = 'coldMark' | 'unmark' | 'restored';

export type LivePerfSample = RedrawCounts & {
  scenario: LivePerfScenario;
  firstRenderSeconds: number;
  menuOpenSeconds: number;
  panelsSeconds: number;
  requests: GithubRequestCounts;
};

/** github.com requests during one sample. `metadata` is a raw or blob read of a metadata file. */
export type GithubRequestCounts = {
  total: number;
  search: number;
  metadata: number;
  other: number;
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
  scenarios: Record<LimitedScenario, ScenarioLimits>;
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

/**
 * Defaults come from the last month of Live E2E run medians, per load.
 * Seconds: round up to 0.1 s of p90 + min(3 s, 10% of p90). Menu open shares
 * one limit, the largest of the three loads. Redraws, reconciles, and DOM
 * mutations must be less than or equal to the highest observed value.
 */
export function defaultLivePerfBudgets(
  env: NodeJS.ProcessEnv = process.env,
): LivePerfBudgets {
  return {
    coldFirstRenderSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_COLD_RENDER_S, 4.7),
    warmFirstRenderSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_WARM_RENDER_S, 4.6),
    hotFirstRenderSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_HOT_RENDER_S, 3.5),
    coldPanelsSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_COLD_PANELS_S, 13.1),
    warmPanelsSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_WARM_PANELS_S, 13.4),
    hotPanelsSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_HOT_PANELS_S, 10.3),
    menuOpenSeconds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_MENU_S, 2.3),
    reconciles: numberEnv(env.DIFFSEEK_LIVE_BUDGET_RECONCILES, 9),
    domMutations: numberEnv(env.DIFFSEEK_LIVE_BUDGET_MUTATIONS, 7),
    actionReconciles: numberEnv(env.DIFFSEEK_LIVE_BUDGET_ACTION_RECONCILES, 8),
    treeRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_TREE_REBUILDS, 0),
    panelRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_PANEL_REBUILDS, 0),
    coldTreeRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_COLD_TREE_REBUILDS, 1),
    coldPanelRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_COLD_PANEL_REBUILDS, 1),
    warmTreeRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_WARM_TREE_REBUILDS, 1),
    warmPanelRebuilds: numberEnv(env.DIFFSEEK_LIVE_BUDGET_WARM_PANEL_REBUILDS, 1),
    // Newer loads: seconds are twice the worst of 5 local runs; counts equal the worst seen locally or on CI.
    scenarios: {
      coldMark: scenarioLimits(env, 'COLD_MARK', { firstRenderSeconds: 6.9, menuOpenSeconds: 5.6, panelsSeconds: 69.7, reconciles: 78, domMutations: 95, treeRebuilds: 0, panelRebuilds: 0 }),
      unmark: scenarioLimits(env, 'UNMARK', { firstRenderSeconds: 12, menuOpenSeconds: 0, panelsSeconds: 12.7, reconciles: 1, domMutations: 2, treeRebuilds: 0, panelRebuilds: 0 }),
      restored: scenarioLimits(env, 'RESTORED', { firstRenderSeconds: 7.6, menuOpenSeconds: 12.9, panelsSeconds: 77.9, reconciles: 39, domMutations: 17, treeRebuilds: 1, panelRebuilds: 1 }),
    },
  };
}

function scenarioLimits(
  env: NodeJS.ProcessEnv,
  name: string,
  defaults: ScenarioLimits,
): ScenarioLimits {
  const limit = (suffix: string, metric: keyof ScenarioLimits) =>
    numberEnv(env[`DIFFSEEK_LIVE_BUDGET_${name}_${suffix}`], defaults[metric]);
  return {
    firstRenderSeconds: limit('RENDER_S', 'firstRenderSeconds'),
    menuOpenSeconds: limit('MENU_S', 'menuOpenSeconds'),
    panelsSeconds: limit('PANELS_S', 'panelsSeconds'),
    reconciles: limit('RECONCILES', 'reconciles'),
    domMutations: limit('MUTATIONS', 'domMutations'),
    treeRebuilds: limit('TREE_REBUILDS', 'treeRebuilds'),
    panelRebuilds: limit('PANEL_REBUILDS', 'panelRebuilds'),
  };
}

function limitsFor(scenario: LivePerfScenario, budgets: LivePerfBudgets): ScenarioLimits {
  if (scenario !== 'cold' && scenario !== 'warm' && scenario !== 'hot') {
    return budgets.scenarios[scenario];
  }
  return {
    firstRenderSeconds: {
      cold: budgets.coldFirstRenderSeconds,
      warm: budgets.warmFirstRenderSeconds,
      hot: budgets.hotFirstRenderSeconds,
    }[scenario],
    menuOpenSeconds: budgets.menuOpenSeconds,
    panelsSeconds: {
      cold: budgets.coldPanelsSeconds,
      warm: budgets.warmPanelsSeconds,
      hot: budgets.hotPanelsSeconds,
    }[scenario],
    reconciles: budgets.reconciles,
    domMutations: budgets.domMutations,
    treeRebuilds: {
      cold: budgets.coldTreeRebuilds,
      warm: budgets.warmTreeRebuilds,
      hot: budgets.treeRebuilds,
    }[scenario],
    panelRebuilds: {
      cold: budgets.coldPanelRebuilds,
      warm: budgets.warmPanelRebuilds,
      hot: budgets.panelRebuilds,
    }[scenario],
  };
}

export function liveSampleCount(env: NodeJS.ProcessEnv = process.env): number {
  return Math.max(1, Math.floor(numberEnv(env.DIFFSEEK_LIVE_SAMPLES, 3)));
}

export function emptyGithubRequestCounts(): GithubRequestCounts {
  return { total: 0, search: 0, metadata: 0, other: 0 };
}

/** Counts one github.com request. raw.githubusercontent.com counts only for metadata reads. */
export function noteGithubRequest(counts: GithubRequestCounts, url: string): void {
  const kind = githubRequestKind(url);
  if (kind == null) return;
  counts.total += 1;
  counts[kind] += 1;
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
  const requests = emptyGithubRequestCounts();
  for (const key of Object.keys(requests) as (keyof GithubRequestCounts)[]) {
    requests[key] = median(samples.map((sample) => sample.requests[key]));
  }
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
    requests,
  };
}

export function actionFailures(
  action: string,
  counts: RedrawCounts,
  budgets: LivePerfBudgets,
): string[] {
  const failures = rebuildFailures(
    {
      ...counts,
      scenario: 'hot',
      firstRenderSeconds: 0,
      menuOpenSeconds: 0,
      panelsSeconds: 0,
      requests: emptyGithubRequestCounts(),
    },
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
  const limits = limitsFor(sample.scenario, budgets);
  const failures: string[] = [];
  if (sample.treeRebuilds > limits.treeRebuilds) {
    failures.push(`${sample.scenario} treeRebuilds ${sample.treeRebuilds} > ${limits.treeRebuilds}`);
  }
  if (sample.panelRebuilds > limits.panelRebuilds) {
    failures.push(`${sample.scenario} panelRebuilds ${sample.panelRebuilds} > ${limits.panelRebuilds}`);
  }
  return failures;
}

/** In-page navigation churns GitHub's own panels. Fail only when rows stay gone. */
export function hotLossFailures(sample: LivePerfSample): string[] {
  const failures: string[] = [];
  if (sample.treeNetLoss > 0) {
    failures.push(`${sample.scenario} treeNetLoss ${sample.treeNetLoss} > 0`);
  }
  if (sample.panelNetLoss > 0) {
    failures.push(`${sample.scenario} panelNetLoss ${sample.panelNetLoss} > 0`);
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
  const limits = limitsFor(sample.scenario, budgets);
  return (['firstRenderSeconds', 'menuOpenSeconds', 'panelsSeconds', 'reconciles', 'domMutations'] as const)
    .filter((metric) => sample[metric] > limits[metric])
    .map((metric) => `${sample.scenario} ${metric} ${sample[metric]} > ${limits[metric]}`);
}

export function livePerfSummary(
  report: { prUrl: string } & Record<LivePerfScenario, LivePerfSample[]>,
): string {
  const rows = livePerfScenarios.map((scenario) => {
    const medianRow = medianSample(report[scenario]);
    const { requests } = medianRow;
    return {
      timing: `| ${scenario} | ${medianRow.firstRenderSeconds} | ${medianRow.menuOpenSeconds} | ${medianRow.panelsSeconds} | ${medianRow.reconciles} | ${medianRow.domMutations} | ${medianRow.treeRebuilds} | ${medianRow.panelRebuilds} | ${medianRow.treeRowsRemoved} | ${medianRow.treeRowsReadded} | ${medianRow.panelsRemoved} | ${medianRow.panelsReadded} | ${medianRow.treeNetLoss} | ${medianRow.panelNetLoss} |`,
      requests: `| ${scenario} | ${requests.total} | ${requests.search} | ${requests.metadata} | ${requests.other} |`,
    };
  });
  return [
    `### DiffSeek live performance`,
    '',
    report.prUrl,
    '',
    '| scenario | first render s | menu s | panels s | reconciles | DOM mutations | tree rebuilds | panel rebuilds | tree removed | tree re-added | panels removed | panels re-added | tree net loss | panel net loss |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((row) => row.timing),
    '',
    '| scenario | github.com requests | /search | raw or blob metadata | other |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...rows.map((row) => row.requests),
    '',
    'Durations and request counts are medians. The total counts github.com plus a raw.githubusercontent.com read of .gitattributes or CODEOWNERS. Metadata is a raw or blob fetch of those files. Other is the rest of the total.',
    'Cold and warm tree rebuilds and diff-panel rebuilds must stay within their caps (a GitHub load redraw may be present or absent). Hot and restored ignore mass removal and fail only when a row removed after the first DiffSeek control is still gone 500 ms later.',
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

function githubRequestKind(url: string): 'search' | 'metadata' | 'other' | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const github = parsed.hostname === 'github.com';
  const rawHost = parsed.hostname === 'raw.githubusercontent.com';
  if (!github && !rawHost) return null;
  if (github && (parsed.pathname === '/search' || parsed.pathname.startsWith('/search/'))) {
    return 'search';
  }
  if (isRawOrBlobMetadata(parsed)) return 'metadata';
  return github ? 'other' : null;
}

function isRawOrBlobMetadata(parsed: URL): boolean {
  let path = parsed.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    path = parsed.pathname;
  }
  const metadataFile = path.endsWith('/.gitattributes') || path.endsWith('/CODEOWNERS');
  if (!metadataFile) return false;
  if (parsed.hostname === 'raw.githubusercontent.com') return true;
  return path.includes('/raw/') || path.includes('/blob/');
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
