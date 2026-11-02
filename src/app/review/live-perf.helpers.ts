import type { RedrawCounts } from './redraw-trace';

/** Live DiffSeek performance defaults for sha-tm/diffseek-test-data#1 (seed 185108). */
export const defaultLivePrUrl =
  'https://github.com/sha-tm/diffseek-test-data/pull/1/changes?new_files_changed=true';

/** Seed `185108` fixture tree marks exactly this many files generated. */
export const expectedGeneratedTotal = 86;

export interface LivePerfBudgets {
  actionReconciles: number;
  coldFirstRenderSeconds: number;
  coldPanelRebuilds: number;
  coldPanelsSeconds: number;
  coldTreeRebuilds: number;
  domMutations: number;
  hotFirstRenderSeconds: number;
  hotPanelsSeconds: number;
  menuOpenSeconds: number;
  panelRebuilds: number;
  reconciles: number;
  treeRebuilds: number;
  warmFirstRenderSeconds: number;
  warmPanelRebuilds: number;
  warmPanelsSeconds: number;
  warmTreeRebuilds: number;
}

export type LivePerfSample = RedrawCounts & {
  firstRenderSeconds: number;
  menuOpenSeconds: number;
  panelsSeconds: number;
  scenario: LivePerfScenario;
};

/**
 * Cold is a first load with an empty extension cache. Warm is a reload.
 * Hot is an in-page navigation back to the files view. `panelsSeconds` ends
 * when the catalog has the full file list and every non-viewed facet is
 * classified. Viewed-state settle is out of scope.
 */
export type LivePerfScenario = 'cold' | 'hot' | 'warm';

/** Shared cold/warm/hot panels cutoff: ceil(1.5x the pooled CI cold median over 5 runs). */
const panelsLimitSeconds = 16;
const actionReconcileBudget = 40;
const coldRenderBudgetSeconds = 12;
const mutationBudget = 12_000;
const hotRenderBudgetSeconds = 8;
const menuBudgetSeconds = 6;
const reconcileBudget = 500;
const warmRenderBudgetSeconds = 10;
const defaultLiveSamples = 3;
const durationFractionDigits = 3;
const millisecondsPerSecond = 1000;
const hotFailurePrefix = 'hot ';
const summaryColumns = [
  'firstRenderSeconds',
  'menuOpenSeconds',
  'panelsSeconds',
  'reconciles',
  'domMutations',
  'treeRebuilds',
  'panelRebuilds',
  'treeRowsRemoved',
  'treeRowsReadded',
  'panelsRemoved',
  'panelsReadded',
  'treeNetLoss',
  'panelNetLoss',
] as const;

export function actionFailures(
  action: string,
  counts: RedrawCounts,
  budgets: LivePerfBudgets,
): string[] {
  return [
    ...rebuildFailures(
      {
        ...counts,
        firstRenderSeconds: 0,
        menuOpenSeconds: 0,
        panelsSeconds: 0,
        scenario: 'hot',
      },
      budgets,
    ).map((failure) => withAction(failure, action)),
    ...overBudget(`${action} reconciles`, counts.reconciles, budgets.actionReconciles),
  ];
}

export function defaultLivePerfBudgets(
  env: NodeJS.ProcessEnv = process.env,
): LivePerfBudgets {
  // Broken GitHub behavior (observed 2026-10-31): GitHub itself now redraws
  // the file tree and diff panels exactly once on a cold load and on a warm
  // reload, with nothing lost. Cold and warm expect exactly this many;
  // temporary, revisit when GitHub stops it.
  return {
    actionReconciles: numberEnv(
      env['DIFFSEEK_LIVE_BUDGET_ACTION_RECONCILES'],
      actionReconcileBudget,
    ),
    coldFirstRenderSeconds: numberEnv(
      env['DIFFSEEK_LIVE_BUDGET_COLD_RENDER_S'],
      coldRenderBudgetSeconds,
    ),
    coldPanelRebuilds: numberEnv(env['DIFFSEEK_LIVE_BUDGET_COLD_PANEL_REBUILDS'], 1),
    coldPanelsSeconds: numberEnv(
      env['DIFFSEEK_LIVE_BUDGET_COLD_PANELS_S'],
      panelsLimitSeconds,
    ),
    coldTreeRebuilds: numberEnv(env['DIFFSEEK_LIVE_BUDGET_COLD_TREE_REBUILDS'], 1),
    domMutations: numberEnv(env['DIFFSEEK_LIVE_BUDGET_MUTATIONS'], mutationBudget),
    hotFirstRenderSeconds: numberEnv(
      env['DIFFSEEK_LIVE_BUDGET_HOT_RENDER_S'],
      hotRenderBudgetSeconds,
    ),
    hotPanelsSeconds: numberEnv(
      env['DIFFSEEK_LIVE_BUDGET_HOT_PANELS_S'],
      panelsLimitSeconds,
    ),
    menuOpenSeconds: numberEnv(env['DIFFSEEK_LIVE_BUDGET_MENU_S'], menuBudgetSeconds),
    panelRebuilds: numberEnv(env['DIFFSEEK_LIVE_BUDGET_PANEL_REBUILDS'], 0),
    reconciles: numberEnv(env['DIFFSEEK_LIVE_BUDGET_RECONCILES'], reconcileBudget),
    treeRebuilds: numberEnv(env['DIFFSEEK_LIVE_BUDGET_TREE_REBUILDS'], 0),
    warmFirstRenderSeconds: numberEnv(
      env['DIFFSEEK_LIVE_BUDGET_WARM_RENDER_S'],
      warmRenderBudgetSeconds,
    ),
    warmPanelRebuilds: numberEnv(env['DIFFSEEK_LIVE_BUDGET_WARM_PANEL_REBUILDS'], 1),
    warmPanelsSeconds: numberEnv(
      env['DIFFSEEK_LIVE_BUDGET_WARM_PANELS_S'],
      panelsLimitSeconds,
    ),
    warmTreeRebuilds: numberEnv(env['DIFFSEEK_LIVE_BUDGET_WARM_TREE_REBUILDS'], 1),
  };
}

/**
 * Denominator-ready generated counter: total is known even when fresh-install
 * hiding leaves the visible numerator at 0.
 */
export function generatedCategorizedPattern(total: number): RegExp {
  return new RegExp(String.raw`^\d+/${String(total)}$`);
}

/** Generated facet shows visible/total; fully indexed + unfiltered is N/N. */
export function generatedIndexedText(total: number): string {
  return `${String(total)}/${String(total)}`;
}

/** Hot navigation churns GitHub's own panels. Fail only when rows stay gone. */
export function hotLossFailures(sample: LivePerfSample): string[] {
  return [
    ...overBudget('hot treeNetLoss', sample.treeNetLoss, 0),
    ...overBudget('hot panelNetLoss', sample.panelNetLoss, 0),
  ];
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
  if (/\/pull\/\d+\/commits\/?$/v.test(parsed.pathname)) return true;
  return (
    parsed.pathname.endsWith('/.gitattributes') ||
    parsed.pathname.endsWith('/CODEOWNERS')
  );
}

/** True when a `visible/total` counter's denominator matches `total`. */
export function isGeneratedCategorized(
  text: null | string | undefined,
  total: number,
): boolean {
  return generatedCategorizedPattern(total).test(text?.trim() ?? '');
}

export function livePerfSummary(report: {
  cold: LivePerfSample[];
  hot: LivePerfSample[];
  prUrl: string;
  warm: LivePerfSample[];
}): string {
  const rows = (['cold', 'warm', 'hot'] as const).map((scenario) => {
    const medianRow = medianSample(report[scenario]);
    const cells = summaryColumns.map((column) => String(medianRow[column]));
    return `| ${scenario} | ${cells.join(' | ')} |`;
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
    'Durations are medians. Cold and warm tree rebuilds and diff-panel rebuilds must be exactly 1 (GitHub redraws once per page load since 2026-10-31, temporary). Hot ignores mass removal and fails only when a row removed after the first DiffSeek control is still gone 500 ms later.',
    '',
  ].join('\n');
}

export function liveSampleCount(env: NodeJS.ProcessEnv = process.env): number {
  const samples = numberEnv(env['DIFFSEEK_LIVE_SAMPLES'], defaultLiveSamples);
  return Math.max(1, Math.floor(samples));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].toSorted((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[mid - 1] ?? 0;
  return Number(((lower + upper) / 2).toFixed(durationFractionDigits));
}

/** Median timings and redraw volume. Durations are noisy; rebuilds are not. */
export function medianBudgetFailures(
  samples: readonly LivePerfSample[],
  budgets: LivePerfBudgets,
): string[] {
  if (samples.length === 0) return ['no samples'];
  const sample = medianSample(samples);
  const { scenario } = sample;
  const renderBudget = {
    cold: budgets.coldFirstRenderSeconds,
    hot: budgets.hotFirstRenderSeconds,
    warm: budgets.warmFirstRenderSeconds,
  }[scenario];
  const panelsBudget = {
    cold: budgets.coldPanelsSeconds,
    hot: budgets.hotPanelsSeconds,
    warm: budgets.warmPanelsSeconds,
  }[scenario];
  return [
    ...overBudget(`${scenario} firstRenderSeconds`, sample.firstRenderSeconds, renderBudget),
    ...overBudget(`${scenario} menuOpenSeconds`, sample.menuOpenSeconds, budgets.menuOpenSeconds),
    ...overBudget(`${scenario} panelsSeconds`, sample.panelsSeconds, panelsBudget),
    ...overBudget(`${scenario} reconciles`, sample.reconciles, budgets.reconciles),
    ...overBudget(`${scenario} domMutations`, sample.domMutations, budgets.domMutations),
  ];
}

export function medianSample(samples: readonly LivePerfSample[]): LivePerfSample {
  const scenario = samples[0]?.scenario ?? 'cold';
  return {
    domMutations: median(samples.map((sample) => sample.domMutations)),
    firstRenderSeconds: median(samples.map((sample) => sample.firstRenderSeconds)),
    menuOpenSeconds: median(samples.map((sample) => sample.menuOpenSeconds)),
    panelNetLoss: median(samples.map((sample) => sample.panelNetLoss)),
    panelRebuilds: median(samples.map((sample) => sample.panelRebuilds)),
    panelsReadded: median(samples.map((sample) => sample.panelsReadded)),
    panelsRemoved: median(samples.map((sample) => sample.panelsRemoved)),
    panelsSeconds: median(samples.map((sample) => sample.panelsSeconds)),
    reconciles: median(samples.map((sample) => sample.reconciles)),
    scenario,
    treeNetLoss: median(samples.map((sample) => sample.treeNetLoss)),
    treeRebuilds: median(samples.map((sample) => sample.treeRebuilds)),
    treeRowsReadded: median(samples.map((sample) => sample.treeRowsReadded)),
    treeRowsRemoved: median(samples.map((sample) => sample.treeRowsRemoved)),
  };
}

/**
 * Cold and warm must hit their exact rebuild counts (GitHub's own one-time
 * redraw), so a DiffSeek rebuild on top of it, or GitHub fixing it, both fail
 * the job. Actions must stay at or under the rebuild caps.
 */
export function rebuildFailures(
  sample: LivePerfSample,
  budgets: LivePerfBudgets,
): string[] {
  const { scenario } = sample;
  if (scenario === 'hot') {
    return [
      ...overBudget(`${scenario} treeRebuilds`, sample.treeRebuilds, budgets.treeRebuilds),
      ...overBudget(`${scenario} panelRebuilds`, sample.panelRebuilds, budgets.panelRebuilds),
    ];
  }
  const cold = scenario === 'cold';
  const tree = cold ? budgets.coldTreeRebuilds : budgets.warmTreeRebuilds;
  const panel = cold ? budgets.coldPanelRebuilds : budgets.warmPanelRebuilds;
  const failures: string[] = [];
  if (sample.treeRebuilds !== tree) {
    failures.push(`${scenario} treeRebuilds ${String(sample.treeRebuilds)} !== ${String(tree)}`);
  }
  if (sample.panelRebuilds !== panel) {
    failures.push(`${scenario} panelRebuilds ${String(sample.panelRebuilds)} !== ${String(panel)}`);
  }
  return failures;
}

export function secondsBetween(started: number, ended = Date.now()): number {
  return Number(((ended - started) / millisecondsPerSecond).toFixed(durationFractionDigits));
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function overBudget(label: string, actual: number, budget: number): string[] {
  return actual > budget ? [`${label} ${String(actual)} > ${String(budget)}`] : [];
}

function withAction(failure: string, action: string): string {
  if (!failure.startsWith(hotFailurePrefix)) return failure;
  return `${action} ${failure.slice(hotFailurePrefix.length)}`;
}

export {type RedrawCounts} from './redraw-trace';