import { browser } from 'wxt/browser';

const rememberedFilterFacets = ['viewed', 'generated'] as const;

export type RememberedFilterFacet =
  (typeof rememberedFilterFacets)[number];
type DefaultViewedFacet = 'generated';
export type FilterDefaults = {
  hidden: Set<RememberedFilterFacet>;
  viewed: Set<DefaultViewedFacet>;
};
export type FilterDefaultState = 'shown' | 'hidden';

const storageKey = 'diffseek:filter-defaults';

export async function readFilterDefaults(): Promise<FilterDefaults> {
  try {
    const value = (await browser.storage.local.get(storageKey))[storageKey];
    // Unset means never configured. Chrome omits the key; the storage test
    // double returns it as undefined. A present value, even an empty record,
    // is an explicit preference and must not be rewritten here.
    if (value === undefined) return unconfiguredDefaults();
    return storedDefaults(value);
  } catch {
    return emptyDefaults();
  }
}

export async function writeFilterDefaults(
  defaults: FilterDefaults,
): Promise<void> {
  const viewed = defaults.viewed.has('generated') ? ['generated'] : [];
  await browser.storage.local
    .set({
      [storageKey]: {
        hidden: [...defaults.hidden],
        viewed,
      },
    })
    .catch(() => undefined);
}

function storedDefaults(value: unknown): FilterDefaults {
  if (!isRecord(value)) return emptyDefaults();
  const hidden = new Set(
    Array.isArray(value.hidden)
      ? value.hidden.filter(isRememberedFilterFacet)
      : [],
  );
  // Older records stored mark-as-read only beside always-hide. `viewed`
  // is now the independent auto-view toggle, so that pair is read as
  // generated always-hide plus auto-view, without rewriting storage.
  const viewed = new Set<DefaultViewedFacet>(
    Array.isArray(value.viewed) && value.viewed.includes('generated')
      ? ['generated']
      : [],
  );
  return { hidden, viewed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRememberedFilterFacet(
  value: unknown,
): value is RememberedFilterFacet {
  return rememberedFilterFacets.some((facet) => facet === value);
}

function unconfiguredDefaults(): FilterDefaults {
  return { hidden: new Set(rememberedFilterFacets), viewed: new Set() };
}

function emptyDefaults(): FilterDefaults {
  return { hidden: new Set(), viewed: new Set() };
}
