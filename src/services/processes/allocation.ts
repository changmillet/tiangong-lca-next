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
    const raw = String(
      typeof entry['@allocatedFraction'] === 'number' ||
        typeof entry['@allocatedFraction'] === 'string'
        ? entry['@allocatedFraction']
        : '',
    )
      .replace('%', '')
      .trim();
    const share = Number(raw);
    if (!raw || !Number.isFinite(share) || share < 0 || share > 100) return 'fraction';
    sum += share;
  }
  return Math.abs(sum - 100) > ALLOCATION_PERCENT_TOLERANCE ? 'total' : undefined;
};

export type AllocationProblem = {
  code: AllocationIssue | 'unverified';
  exchangeId: string;
  targetIds: string[];
};

export const allocationTargetIds = (exchange: ProcessExchangeData) =>
  allocationEntries(exchange.allocations?.allocation)
    .map((entry) => String(entry['@internalReferenceToCoProduct'] ?? '').trim())
    .filter(Boolean);

export const allocationDependents = (exchanges: ProcessExchangeData[], targetId: string) =>
  exchanges.filter(
    (exchange) =>
      String(exchange['@dataSetInternalID']) !== targetId &&
      allocationTargetIds(exchange).includes(targetId),
  );

// Do not recycle a dangling target ID when adding a row to a repairable draft.
export const nextExchangeId = (exchanges: ProcessExchangeData[]) => {
  const reserved = new Set(
    exchanges.flatMap((exchange) => [
      String(exchange['@dataSetInternalID']),
      ...allocationTargetIds(exchange),
    ]),
  );
  let id = 0;
  while (reserved.has(String(id))) id += 1;
  return String(id);
};

export const collectAllocationProblems = (
  exchanges: ProcessExchangeData[],
): AllocationProblem[] => {
  const declared = exchanges.filter((exchange) => hasAllocation(exchange.allocations?.allocation));
  const legacy = declared.filter((exchange) =>
    isLegacyAllocation(exchange.allocations?.allocation),
  );
  const problem = (exchange: ProcessExchangeData, code: AllocationIssue): AllocationProblem => ({
    code,
    exchangeId: String(exchange['@dataSetInternalID']),
    targetIds: allocationTargetIds(exchange),
  });
  if (legacy.length && legacy.length !== declared.length)
    return declared.map((exchange) => problem(exchange, 'mixed'));
  if (legacy.length) {
    const inputs = legacy.filter(
      (exchange) => exchange.exchangeDirection?.toUpperCase() !== 'OUTPUT',
    );
    if (inputs.length) return inputs.map((exchange) => problem(exchange, 'legacyInput'));
    let sum = 0;
    const invalid = legacy.filter((exchange) => {
      let bad = false;
      for (const entry of allocationEntries(exchange.allocations?.allocation)) {
        const raw = String(
          typeof entry['@allocatedFraction'] === 'number' ||
            typeof entry['@allocatedFraction'] === 'string'
            ? entry['@allocatedFraction']
            : '',
        )
          .replace('%', '')
          .trim();
        const share = Number(raw);
        if (!raw || !Number.isFinite(share) || share < 0 || share > 100) bad = true;
        sum += share;
      }
      return bad;
    });
    if (invalid.length) return invalid.map((exchange) => problem(exchange, 'fraction'));
    return Math.abs(sum - 100) > ALLOCATION_PERCENT_TOLERANCE
      ? legacy.map((exchange) => problem(exchange, 'total'))
      : [];
  }
  const targets = new Set(
    exchanges
      .filter((exchange) => exchange.exchangeDirection?.toUpperCase() === 'OUTPUT')
      .map((exchange) => String(exchange['@dataSetInternalID'])),
  );
  return declared.flatMap((exchange) => {
    const issue = validateAllocation(exchange.allocations?.allocation, targets);
    return issue ? [problem(exchange, issue)] : [];
  });
};

export const validateProcessAllocations = (exchanges: ProcessExchangeData[]) =>
  collectAllocationProblems(exchanges)[0]?.code;

// A plain save may retain existing allocation problems while unrelated fields
// are repaired. Changes to allocation identities, targets or shares are never
// authorized by this exception; validation/review always use the strict path.
export const canRetainAllocationDraft = (
  original: ProcessExchangeData[] | undefined,
  current: ProcessExchangeData[],
) => {
  if (!original?.length) return false;
  const signature = (rows: ProcessExchangeData[]) =>
    JSON.stringify(
      rows.map((exchange) => {
        const reference = Array.isArray(exchange.referenceToFlowDataSet)
          ? exchange.referenceToFlowDataSet[0]
          : exchange.referenceToFlowDataSet;
        return {
          id: exchange['@dataSetInternalID'],
          direction: exchange.exchangeDirection,
          reference: exchange.quantitativeReference,
          flowId: reference?.['@refObjectId'],
          flowVersion: reference?.['@version'],
          allocation: normalizeAllocation(exchange.allocations?.allocation),
        };
      }),
    );
  return signature(original) === signature(current);
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
