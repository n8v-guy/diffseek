import { browser } from 'wxt/browser';

const rememberedFilterFacets = ['viewed', 'generated'] as const;

export type RememberedFilterFacet =
  (typeof rememberedFilterFacets)[number];
type DefaultViewedFacet = 'generated';
export type FilterDefaults = {
  hidden: Set<RememberedFilterFacet>;
  viewed: Set<DefaultViewedFacet>;
};
export type FilterDefaultState = 'shown' | 'hidden' | 'hidden-viewed';

const storageKey = 'diffseek:filter-defaults';

export async function readFilterDefaults(): Promise<FilterDefaults> {
  try {
    const value = (await browser.storage.local.get(storageKey))[storageKey];
    if (!isRecord(value)) return emptyDefaults();
    const hidden = new Set(
      Array.isArray(value.hidden)
        ? value.hidden.filter(isRememberedFilterFacet)
        : [],
    );
    const viewed = new Set<DefaultViewedFacet>(
      Array.isArray(value.viewed) &&
        value.viewed.includes('generated') &&
        hidden.has('generated')
        ? ['generated']
        : [],
    );
    return { hidden, viewed };
  } catch {
    return emptyDefaults();
  }
}

export async function writeFilterDefaults(
  defaults: FilterDefaults,
): Promise<void> {
  const viewed =
    defaults.hidden.has('generated') &&
    defaults.viewed.has('generated')
      ? ['generated']
      : [];
  await browser.storage.local
    .set({
      [storageKey]: {
        hidden: [...defaults.hidden],
        viewed,
      },
    })
    .catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRememberedFilterFacet(
  value: unknown,
): value is RememberedFilterFacet {
  return rememberedFilterFacets.some((facet) => facet === value);
}

function emptyDefaults(): FilterDefaults {
  return { hidden: new Set(), viewed: new Set() };
}
