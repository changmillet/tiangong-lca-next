import { normalizeOptionalTidasPercentage } from '../general/tidasScalarStorage';
import type { ProcessExchangeData } from './data';

export type Allocation = {
  '@internalReferenceToCoProduct'?: string | number;
  '@allocatedFraction'?: string | number;
};
export type AllocationValue = Allocation | Allocation[] | undefined;
export const ALLOCATION_PERCENT_TOLERANCE = 0.0010000001;

export const allocationEntries = (value: AllocationValue): Allocation[] =>
  value === undefined
    ? []
    : Array.isArray(value)
      ? value
      : Object.keys(value).length
        ? [value]
        : [];

// Preserve object/array shape and zero shares across storage and editor round trips.
export const normalizeAllocation = (value: AllocationValue): AllocationValue => {
  const normalize = (entry: Allocation): Allocation => ({
    ...entry,
    '@internalReferenceToCoProduct':
      entry['@internalReferenceToCoProduct'] === undefined
        ? undefined
        : String(entry['@internalReferenceToCoProduct']),
    '@allocatedFraction': normalizeOptionalTidasPercentage(
      typeof entry['@allocatedFraction'] === 'string'
        ? entry['@allocatedFraction'].replace('%', '')
        : entry['@allocatedFraction'],
    ) as Allocation['@allocatedFraction'],
  });
  return value === undefined
    ? undefined
    : Array.isArray(value)
      ? value.map(normalize)
      : normalize(value);
};

export const hasAllocation = (value: AllocationValue) =>
  (Array.isArray(value) && value.length > 0) ||
  allocationEntries(value).some((entry) =>
    Object.values(entry).some((part) => part !== undefined && part !== ''),
  );

export const isLegacyAllocation = (value: AllocationValue) =>
  hasAllocation(value) &&
  allocationEntries(value).every(
    (entry) => !String(entry['@internalReferenceToCoProduct'] ?? '').trim(),
  );

export type AllocationIssue =
  'target' | 'duplicate' | 'fraction' | 'total' | 'mixed' | 'legacyInput';

export const validateAllocation = (
  value: AllocationValue,
  targetIds: ReadonlySet<string>,
): AllocationIssue | undefined => {
  if (!hasAllocation(value)) return undefined;
  const seen = new Set<string>();
  let sum = 0;
  for (const entry of allocationEntries(value)) {
    const target = String(entry['@internalReferenceToCoProduct'] ?? '').trim();
    if (!targetIds.has(target)) return 'target';
    if (seen.has(target)) return 'duplicate';
    seen.add(target);
    const raw = String(entry['@allocatedFraction'] ?? '')
      .replace('%', '')
      .trim();
    const share = Number(raw);
    if (!raw || !Number.isFinite(share) || share < 0 || share > 100) return 'fraction';
    sum += share;
  }
  return Math.abs(sum - 100) > ALLOCATION_PERCENT_TOLERANCE ? 'total' : undefined;
};

export const validateProcessAllocations = (
  exchanges: ProcessExchangeData[],
): AllocationIssue | undefined => {
  const declared = exchanges.filter((exchange) => hasAllocation(exchange.allocations?.allocation));
  const legacy = declared.filter((exchange) =>
    isLegacyAllocation(exchange.allocations?.allocation),
  );
  if (legacy.length && legacy.length !== declared.length) return 'mixed';
  if (legacy.length) {
    if (legacy.some((exchange) => exchange.exchangeDirection?.toUpperCase() !== 'OUTPUT'))
      return 'legacyInput';
    const shares = legacy
      .flatMap((exchange) => allocationEntries(exchange.allocations?.allocation))
      .map((entry) =>
        Number(
          typeof entry['@allocatedFraction'] === 'number'
            ? entry['@allocatedFraction']
            : typeof entry['@allocatedFraction'] === 'string'
              ? entry['@allocatedFraction'].replace('%', '')
              : NaN,
        ),
      );
    if (shares.some((share) => !Number.isFinite(share) || share < 0 || share > 100))
      return 'fraction';
    return Math.abs(shares.reduce((sum, share) => sum + share, 0) - 100) >
      ALLOCATION_PERCENT_TOLERANCE
      ? 'total'
      : undefined;
  }
  const targets = new Set(
    exchanges
      .filter((exchange) => exchange.exchangeDirection?.toUpperCase() === 'OUTPUT')
      .map((exchange) => String(exchange['@dataSetInternalID'])),
  );
  for (const exchange of declared) {
    const issue = validateAllocation(exchange.allocations?.allocation, targets);
    if (issue) return issue;
  }
  return undefined;
};

export const applyBatchAllocation = (
  exchanges: ProcessExchangeData[],
  selectedIds: ReadonlySet<string>,
  value: AllocationValue,
  mode: 'empty' | 'replace',
  targetIds: ReadonlySet<string>,
): ProcessExchangeData[] => {
  const issue = validateAllocation(value, targetIds);
  if (issue || !hasAllocation(value)) throw new Error(issue ?? 'target');
  const result = exchanges.map((exchange) => {
    if (
      !selectedIds.has(String(exchange['@dataSetInternalID'])) ||
      (mode === 'empty' && hasAllocation(exchange.allocations?.allocation))
    )
      return exchange;
    return {
      ...exchange,
      allocations: {
        allocation: allocationEntries(normalizeAllocation(value)).map((entry) => ({ ...entry })),
      },
    };
  });
  const resultIssue = validateProcessAllocations(result);
  if (resultIssue) throw new Error(resultIssue);
  return result;
};
