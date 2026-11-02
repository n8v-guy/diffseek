import { isUnknownArray } from '@diffseek/browser/record';

import type { RedrawCounts } from './redraw-trace';

/** Live DiffSeek performance defaults for sha-tm/diffseek-test-data#1 (seed 185108). */
export const defaultLivePrUrl =
  'https://github.com/sha-tm/diffseek-test-data/pull/1/changes?new_files_changed=true';

/** Seed `185108` fixture tree marks exactly this many files generated. */
export const expectedGeneratedTotal = 86;

export interface CookieLike {
  domain: string;
  expires?: number;
  httpOnly?: boolean;
  name: string;
  path?: string;
  sameSite?: 'Lax' | 'None' | 'Strict';
  secure?: boolean;
  value: string;
}

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
const hotFailurePrefix = 'hot ';

export function actionFailures(
  action: string,
  counts: RedrawCounts,
  budgets: LivePerfBudgets,
): string[] {
  const failures = rebuildFailures(
    {
      ...counts,
      firstRenderSeconds: 0,
      menuOpenSeconds: 0,
      panelsSeconds: 0,
      scenario: 'hot',
    },
    budgets,
  ).map((failure) => withAction(failure, action));
  if (counts.reconciles > budgets.actionReconciles) {
    failures.push(
      `${action} reconciles ${counts.reconciles} > ${budgets.actionReconciles}`,
    );
  }
  return failures;
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
  return new RegExp(String.raw`^\d+/${total}$`);
}

/** Generated facet shows visible/total; fully indexed + unfiltered is N/N. */
export function generatedIndexedText(total: number): string {
  return `${total}/${total}`;
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

/** Cursor/GitHub secrets inject JSON; local runs usually pass a file path. */
export function isInlineStorageState(source: string): boolean {
  return source.trimStart().startsWith('{');
}

export function livePerfSummary(report: {
  cold: LivePerfSample[];
  hot: LivePerfSample[];
  prUrl: string;
  warm: LivePerfSample[];
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
  const failures: string[] = [];
  const renderBudget = {
    cold: budgets.coldFirstRenderSeconds,
    hot: budgets.hotFirstRenderSeconds,
    warm: budgets.warmFirstRenderSeconds,
  }[sample.scenario];
  const panelsBudget = {
    cold: budgets.coldPanelsSeconds,
    hot: budgets.hotPanelsSeconds,
    warm: budgets.warmPanelsSeconds,
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

export function parseInlineStorageState(source: string): unknown {
  return JSON.parse(source);
}

export function parseStorageCookies(raw: unknown): CookieLike[] {
  const cookies = isRecord(raw) ? raw['cookies'] : undefined;
  if (!isUnknownArray(cookies)) {
    throw new Error('storageState JSON must include a cookies array');
  }
  return cookies.map((cookie, index) => readCookie(cookie, index));
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
  const failures: string[] = [];
  if (sample.scenario === 'cold' || sample.scenario === 'warm') {
    const cold = sample.scenario === 'cold';
    const tree = cold ? budgets.coldTreeRebuilds : budgets.warmTreeRebuilds;
    const panel = cold ? budgets.coldPanelRebuilds : budgets.warmPanelRebuilds;
    if (sample.treeRebuilds !== tree) {
      failures.push(`${sample.scenario} treeRebuilds ${sample.treeRebuilds} !== ${tree}`);
    }
    if (sample.panelRebuilds !== panel) {
      failures.push(`${sample.scenario} panelRebuilds ${sample.panelRebuilds} !== ${panel}`);
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

const sameSites = ['Lax', 'None', 'Strict'] as const;

function cookieIdentity(
  cookie: Record<string, unknown>,
  index: number,
): { name: string; value: string } {
  const name = cookie['name'];
  const value = cookie['value'];
  if (typeof name !== 'string' || typeof value !== 'string') {
    throw new TypeError(`storageState cookies[${index}] is missing name/value`);
  }
  return { name, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function optionalSameSite(value: unknown): CookieLike['sameSite'] {
  if (typeof value !== 'string') return undefined;
  return sameSites.find((site) => site === value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readCookie(cookie: unknown, index: number): CookieLike {
  if (!isRecord(cookie)) {
    throw new Error(`storageState cookies[${index}] is invalid`);
  }
  const identity = cookieIdentity(cookie, index);
  const domain = cookie['domain'];
  if (typeof domain !== 'string') {
    throw new TypeError(`storageState cookies[${index}] is missing domain`);
  }
  const expires = optionalNumber(cookie['expires']);
  const httpOnly = optionalBoolean(cookie['httpOnly']);
  const path = optionalString(cookie['path']);
  const sameSite = optionalSameSite(cookie['sameSite']);
  const secure = optionalBoolean(cookie['secure']);
  return {
    domain,
    name: identity.name,
    value: identity.value,
    ...(expires !== undefined && { expires }),
    ...(httpOnly !== undefined && { httpOnly }),
    ...(path !== undefined && { path }),
    ...(sameSite !== undefined && { sameSite }),
    ...(secure !== undefined && { secure }),
  };
}

function withAction(failure: string, action: string): string {
  if (!failure.startsWith(hotFailurePrefix)) return failure;
  return `${action} ${failure.slice(hotFailurePrefix.length)}`;
}

export {type RedrawCounts} from './redraw-trace';