/** Frozen LCIA category availability. Missing results never authorize a numerical zero. */
export type LciaCategoryAvailability = {
  impact_index: number;
  method_id: string;
  method_version: string;
  status: 'available' | 'unavailable';
  reasons: string[];
};

export type LciaAvailability = {
  schema_version: 'lcia.category-availability.v1';
  policy_version: 'lcia.applicability.source-bound.v2';
  completeness: 'complete' | 'partial' | 'unavailable';
  categories: LciaCategoryAvailability[];
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function finiteLciaValue(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseLciaAvailability(value: unknown): LciaAvailability | null {
  if (value === undefined || value === null) return null;
  if (
    !record(value) ||
    Object.keys(value).sort().join(',') !==
      'categories,completeness,policy_version,schema_version' ||
    value.schema_version !== 'lcia.category-availability.v1' ||
    value.policy_version !== 'lcia.applicability.source-bound.v2' ||
    !Array.isArray(value.categories) ||
    value.categories.length === 0 ||
    value.categories.length > 256
  )
    throw new Error('lcia_availability_invalid');
  const identities = new Set<string>();
  let available = 0;
  value.categories.forEach((category, index) => {
    if (
      !record(category) ||
      Object.keys(category).sort().join(',') !==
        'impact_index,method_id,method_version,reasons,status' ||
      category.impact_index !== index ||
      typeof category.method_id !== 'string' ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(category.method_id) ||
      typeof category.method_version !== 'string' ||
      !/^\d{2}\.\d{2}\.\d{3}$/.test(category.method_version) ||
      !['available', 'unavailable'].includes(String(category.status)) ||
      !Array.isArray(category.reasons) ||
      category.reasons.length > 32 ||
      !category.reasons.every(
        (reason, reasonIndex, reasons) =>
          typeof reason === 'string' &&
          /^[a-z0-9_]{1,160}$/.test(reason) &&
          (reasonIndex === 0 || reasons[reasonIndex - 1] < reason),
      ) ||
      (category.status === 'available') !== (category.reasons.length === 0)
    )
      throw new Error('lcia_availability_category_invalid');
    const identity = `${category.method_id}:${category.method_version}`;
    if (identities.has(identity)) throw new Error('lcia_availability_axis_invalid');
    identities.add(identity);
    if (category.status === 'available') available++;
  });
  const expected =
    available === value.categories.length
      ? 'complete'
      : available === 0
        ? 'unavailable'
        : 'partial';
  if (value.completeness !== expected) throw new Error('lcia_availability_completeness_invalid');
  return value as LciaAvailability;
}

export function lciaValueIsUnavailable(row: {
  value?: unknown;
  meanAmount?: unknown;
  status?: unknown;
}): boolean {
  return (
    row.status === 'unavailable' ||
    finiteLciaValue('value' in row ? row.value : row.meanAmount) === null
  );
}

export function normalizeLciaValueRow<
  T extends { value?: unknown; status?: unknown; reasons?: unknown },
>(row: T) {
  const value = row.status === 'unavailable' ? null : finiteLciaValue(row.value);
  return {
    ...row,
    value,
    status: value === null ? ('unavailable' as const) : ('available' as const),
    reasons: Array.isArray(row.reasons)
      ? row.reasons.filter((reason): reason is string => typeof reason === 'string')
      : [],
  };
}

export function validateLciaQueryRows(rows: unknown, availability: LciaAvailability): void {
  if (!Array.isArray(rows) || rows.length !== availability.categories.length)
    throw new Error('lcia_availability_axis_invalid');
  const seen = new Set<number>();
  rows.forEach((row) => {
    if (!record(row) || !Number.isInteger(row.impact_index))
      throw new Error('lcia_availability_row_invalid');
    const category = availability.categories[Number(row.impact_index)];
    if (
      !category ||
      seen.has(category.impact_index) ||
      row.impact_id !== category.method_id ||
      row.impact_version !== category.method_version ||
      row.status !== category.status ||
      JSON.stringify(row.reasons) !== JSON.stringify(category.reasons)
    )
      throw new Error('lcia_availability_row_mismatch');
    seen.add(category.impact_index);
    if (
      category.status === 'unavailable' ? row.value !== null : finiteLciaValue(row.value) === null
    )
      throw new Error('lcia_availability_value_mismatch');
  });
}

export function validateLciaImpactQueryData(
  data: unknown,
  category: LciaCategoryAvailability,
  processIds?: string[],
): void {
  if (
    !record(data) ||
    data.impact_id !== category.method_id ||
    data.impact_index !== category.impact_index ||
    (data.impact_version !== undefined && data.impact_version !== category.method_version) ||
    (data.status !== undefined && data.status !== category.status) ||
    (data.reasons !== undefined &&
      JSON.stringify(data.reasons) !== JSON.stringify(category.reasons))
  ) {
    throw new Error('lcia_availability_row_mismatch');
  }
  if (category.status !== 'available') throw new Error('lcia_category_unavailable');
  const finiteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  if (processIds?.length) {
    if (data.kind !== 'selected_processes' || !record(data.values))
      throw new Error('lcia_availability_values_invalid');
    const expected = [...new Set(processIds.map((id) => id.trim()))].sort();
    if (
      Object.keys(data.values).sort().join(',') !== expected.join(',') ||
      !Object.values(data.values).every(finiteNumber)
    )
      throw new Error('lcia_availability_values_invalid');
    return;
  }
  if (
    data.kind !== 'ranked_processes' ||
    !Array.isArray(data.values) ||
    !Number.isSafeInteger(data.offset) ||
    Number(data.offset) < 0 ||
    !Number.isSafeInteger(data.limit) ||
    Number(data.limit) <= 0 ||
    data.returned_count !== data.values.length ||
    !Number.isSafeInteger(data.total_process_count) ||
    Number(data.total_process_count) < 0 ||
    data.values.length >
      Math.min(
        Number(data.limit),
        Math.max(0, Number(data.total_process_count) - Number(data.offset)),
      ) ||
    !finiteNumber(data.total_absolute_value) ||
    data.total_absolute_value < 0
  ) {
    throw new Error('lcia_availability_values_invalid');
  }
  const indices = new Set<number>();
  for (const row of data.values) {
    if (
      !record(row) ||
      typeof row.process_id !== 'string' ||
      !row.process_id.trim() ||
      typeof row.process_version !== 'string' ||
      !/^\d{2}\.\d{2}\.\d{3}$/.test(row.process_version) ||
      !Number.isSafeInteger(row.process_index) ||
      Number(row.process_index) < 0 ||
      indices.has(Number(row.process_index)) ||
      !finiteNumber(row.value) ||
      !finiteNumber(row.absolute_value) ||
      row.absolute_value !== Math.abs(row.value) ||
      (row.status !== undefined && row.status !== 'available') ||
      (row.reasons !== undefined && JSON.stringify(row.reasons) !== '[]')
    ) {
      throw new Error('lcia_availability_values_invalid');
    }
    indices.add(Number(row.process_index));
  }
}

export type BundleLciaExtent = {
  firstProcessIndex?: number;
  lastProcessIndex?: number;
  recordCount: number;
  selectedProcessIndex: number;
  processCount: number;
};

export function validateBundleLciaRows(
  rows: Array<{
    processIndex: number;
    method: { id: string; version: string };
    meanAmount: number | null;
    status?: 'available' | 'unavailable';
    reasons?: string[];
  }>,
  availability?: LciaAvailability,
  extent?: BundleLciaExtent,
): void {
  if (!extent) {
    if (availability) throw new Error('lcia_artifact_process_extent_missing');
    return;
  }
  const first = extent.firstProcessIndex;
  const last = extent.lastProcessIndex;
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(last) ||
    Number(first) < 0 ||
    Number(last) < Number(first) ||
    !Number.isSafeInteger(extent.processCount) ||
    extent.processCount <= 0 ||
    Number(last) >= extent.processCount ||
    !Number.isSafeInteger(extent.selectedProcessIndex) ||
    extent.selectedProcessIndex < Number(first) ||
    extent.selectedProcessIndex > Number(last) ||
    !Number.isSafeInteger(extent.recordCount) ||
    extent.recordCount !== rows.length
  )
    throw new Error('lcia_artifact_process_extent_invalid');
  const processCount = Number(last) - Number(first) + 1;
  const expectedRecords = availability
    ? processCount * availability.categories.length
    : extent.recordCount;
  if (
    !Number.isSafeInteger(processCount) ||
    !Number.isSafeInteger(expectedRecords) ||
    expectedRecords !== rows.length
  ) {
    throw new Error('lcia_artifact_process_cardinality_mismatch');
  }
  const byMethod = new Map(
    availability?.categories.map((category) => [
      `${category.method_id}:${category.method_version}`,
      category,
    ]),
  );
  const seen = new Map<number, Set<string>>();
  for (const row of rows) {
    if (
      !Number.isSafeInteger(row.processIndex) ||
      row.processIndex < Number(first) ||
      row.processIndex > Number(last)
    )
      throw new Error('lcia_artifact_process_extent_invalid');
    const identity = `${row.method.id}:${row.method.version}`;
    const process = seen.get(row.processIndex) ?? new Set<string>();
    if (process.has(identity)) throw new Error('lcia_availability_axis_invalid');
    process.add(identity);
    seen.set(row.processIndex, process);
    if (!availability) continue;
    const category = byMethod.get(identity);
    if (!category) throw new Error('lcia_availability_row_mismatch');
    if (
      category.status === 'unavailable'
        ? row.meanAmount !== null || row.status !== 'unavailable'
        : typeof row.meanAmount !== 'number' ||
          !Number.isFinite(row.meanAmount) ||
          row.status === 'unavailable'
    )
      throw new Error('lcia_availability_value_mismatch');
    if (JSON.stringify(row.reasons ?? []) !== JSON.stringify(category.reasons))
      throw new Error('lcia_availability_row_mismatch');
  }
  if (
    seen.size !== processCount ||
    !seen.has(extent.selectedProcessIndex) ||
    (availability &&
      Array.from(seen.values()).some((indices) => indices.size !== availability.categories.length))
  )
    throw new Error('lcia_artifact_process_cardinality_mismatch');
}
