export type PmMachineAsset = { id: number; asset_number: string };

export type PmAssetResolution<T extends PmMachineAsset> =
  | { status: 'resolved'; asset: T; matchType: 'exact' | 'press_alias'; alias: string | null }
  | { status: 'ambiguous'; assets: T[]; matchType: 'exact' | 'press_alias'; alias: string | null }
  | { status: 'missing'; matchType: null; alias: string | null };

export function normalizedPmKey(value: unknown) {
  return String(value ?? '').replace(/\r/g, '').trim().replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').toLowerCase();
}

export function strictPressNumberAlias(value: unknown): string | null {
  const normalized = normalizedPmKey(value);
  const match = /^(?:([0-9]+)|press\s+([0-9]+)|press\s+#\s*([0-9]+)|press\s+(?:no\.?|number)\s+([0-9]+))$/.exec(normalized);
  const digits = match?.slice(1).find(Boolean);
  if (!digits) return null;
  const canonicalNumber = digits.replace(/^0+(?=\d)/, '');
  return `press:${canonicalNumber}`;
}

function appendIndexValue<T>(index: Map<string, T[]>, key: string | null, value: T) {
  if (!key) return;
  index.set(key, [...(index.get(key) ?? []), value]);
}

export function createPmMachineAssetResolver<T extends PmMachineAsset>(assets: readonly T[]) {
  const exactByNumber = new Map<string, T[]>();
  const byPressAlias = new Map<string, T[]>();
  for (const asset of assets) {
    appendIndexValue(exactByNumber, normalizedPmKey(asset.asset_number), asset);
    appendIndexValue(byPressAlias, strictPressNumberAlias(asset.asset_number), asset);
  }

  return {
    exactByNumber,
    byPressAlias,
    resolve(workbookIdentifier: unknown): PmAssetResolution<T> {
      const exact = exactByNumber.get(normalizedPmKey(workbookIdentifier)) ?? [];
      if (exact.length === 1) return { status: 'resolved', asset: exact[0], matchType: 'exact', alias: null };
      if (exact.length > 1) return { status: 'ambiguous', assets: exact, matchType: 'exact', alias: null };

      const alias = strictPressNumberAlias(workbookIdentifier);
      if (!alias) return { status: 'missing', matchType: null, alias: null };
      const aliases = byPressAlias.get(alias) ?? [];
      if (aliases.length === 1) return { status: 'resolved', asset: aliases[0], matchType: 'press_alias', alias };
      if (aliases.length > 1) return { status: 'ambiguous', assets: aliases, matchType: 'press_alias', alias };
      return { status: 'missing', matchType: null, alias };
    },
  };
}
