import {
  finiteLciaValue,
  lciaValueIsUnavailable,
  normalizeLciaValueRow,
  parseLciaAvailability,
  validateBundleLciaRows,
  validateLciaQueryRows,
  validateLciaImpactQueryData,
  type LciaAvailability,
} from '@/services/lca/categoryAvailability';

const receipt: LciaAvailability = {
  schema_version: 'lcia.category-availability.v1',
  policy_version: 'lcia.applicability.source-bound.v3',
  completeness: 'partial',
  categories: [
    {
      impact_index: 0,
      method_id: '11111111-1111-4111-8111-111111111111',
      method_version: '01.00.000',
      status: 'available',
      reasons: [],
    },
    {
      impact_index: 1,
      method_id: '22222222-2222-4222-8222-222222222222',
      method_version: '01.00.000',
      status: 'unavailable',
      reasons: ['lcia_factor_location_semantics_unresolved'],
    },
  ],
};

it('keeps known zero distinct from null, missing, blank, booleans and invalid values', () => {
  expect(finiteLciaValue(0)).toBe(0);
  expect(finiteLciaValue('0')).toBe(0);
  for (const value of [null, undefined, '', ' ', true, false, {}, NaN, Infinity])
    expect(finiteLciaValue(value)).toBeNull();
  expect(normalizeLciaValueRow({ value: 42, status: 'unavailable' }).value).toBeNull();
});

it('validates frozen axis, reasons and completeness without inventing historical receipts', () => {
  expect(parseLciaAvailability(undefined)).toBeNull();
  expect(parseLciaAvailability(receipt)).toEqual(receipt);
  expect(() => parseLciaAvailability({ ...receipt, completeness: 'complete' })).toThrow();
  expect(() =>
    parseLciaAvailability({ ...receipt, categories: [...receipt.categories].reverse() }),
  ).toThrow();
});

it('binds nullable query values to exact category revisions and refuses unknown zero', () => {
  const rows = receipt.categories.map((c) => ({
    impact_index: c.impact_index,
    impact_id: c.method_id,
    impact_version: c.method_version,
    status: c.status,
    reasons: c.reasons,
    value: c.status === 'available' ? 0 : null,
  }));
  expect(() => validateLciaQueryRows(rows, receipt)).not.toThrow();
  expect(() => validateLciaQueryRows([rows[0], { ...rows[1], value: 0 }], receipt)).toThrow();
  expect(() =>
    validateLciaQueryRows([rows[0], { ...rows[1], impact_version: '02.00.000' }], receipt),
  ).toThrow();
});

it('keeps partial bundle categories explicit and rejects missing or mismatched rows', () => {
  const rows = receipt.categories.map((c) => ({
    processIndex: 0,
    method: { id: c.method_id, version: c.method_version },
    status: c.status,
    reasons: c.reasons,
    meanAmount: c.status === 'available' ? 0 : null,
  }));
  const extent = {
    firstProcessIndex: 0,
    lastProcessIndex: 0,
    recordCount: 2,
    selectedProcessIndex: 0,
    processCount: 1,
  };
  expect(() => validateBundleLciaRows(rows, receipt, extent)).not.toThrow();
  expect(() => validateBundleLciaRows(rows.slice(0, 1), receipt, extent)).toThrow();
  expect(() =>
    validateBundleLciaRows([rows[0], { ...rows[1], meanAmount: 0 }], receipt, extent),
  ).toThrow();
  expect(() => validateBundleLciaRows([], receipt, extent)).toThrow();
  expect(() =>
    validateBundleLciaRows(rows, receipt, {
      ...extent,
      lastProcessIndex: 1,
      processCount: 2,
      recordCount: rows.length,
      selectedProcessIndex: 1,
    }),
  ).toThrow();
  const completeRange = [...rows, ...rows.map((row) => ({ ...row, processIndex: 1 }))];
  expect(() =>
    validateBundleLciaRows(completeRange, receipt, {
      ...extent,
      lastProcessIndex: 1,
      processCount: 2,
      recordCount: 4,
      selectedProcessIndex: 1,
    }),
  ).not.toThrow();
  expect(() =>
    validateBundleLciaRows(completeRange, receipt, {
      ...extent,
      lastProcessIndex: 1,
      processCount: 2,
      recordCount: 4,
      selectedProcessIndex: 2,
    }),
  ).toThrow();
});

it('rejects extra keys, noncanonical UUID case, and unbounded category receipts', () => {
  expect(() => parseLciaAvailability({ ...receipt, extra: true })).toThrow(
    'lcia_availability_invalid',
  );
  expect(() =>
    parseLciaAvailability({
      ...receipt,
      categories: receipt.categories.map((category, index) =>
        index === 0 ? { ...category, extra: true } : category,
      ),
    }),
  ).toThrow('lcia_availability_category_invalid');
  expect(() =>
    parseLciaAvailability({
      ...receipt,
      categories: [
        { ...receipt.categories[0], method_id: 'AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        receipt.categories[1],
      ],
    }),
  ).toThrow('lcia_availability_category_invalid');
  expect(() =>
    parseLciaAvailability({
      ...receipt,
      categories: Array.from({ length: 257 }, () => receipt.categories[0]),
    }),
  ).toThrow('lcia_availability_invalid');
});

it('retires v2 receipts and rejects duplicate identities or noncanonical reason ordering', () => {
  expect(() =>
    parseLciaAvailability({ ...receipt, policy_version: 'lcia.applicability.source-bound.v2' }),
  ).toThrow('lcia_availability_invalid');
  expect(() =>
    parseLciaAvailability({
      ...receipt,
      categories: [receipt.categories[0], { ...receipt.categories[0], impact_index: 1 }],
    }),
  ).toThrow('lcia_availability_axis_invalid');
  expect(() =>
    parseLciaAvailability({
      ...receipt,
      categories: [receipt.categories[0], { ...receipt.categories[1], reasons: ['z', 'a'] }],
    }),
  ).toThrow('lcia_availability_category_invalid');
});

it('normalizes historical amount fields while retaining only string reason codes', () => {
  expect(lciaValueIsUnavailable({ meanAmount: '0' })).toBe(false);
  expect(lciaValueIsUnavailable({ meanAmount: undefined })).toBe(true);
  expect(lciaValueIsUnavailable({ value: 0 })).toBe(false);
  expect(normalizeLciaValueRow({ value: '0', reasons: ['source_unknown', 17, null] })).toEqual({
    value: 0,
    status: 'available',
    reasons: ['source_unknown'],
  });
});

it('rejects malformed or incomplete full-category query axes before display', () => {
  const rows = receipt.categories.map((category) => ({
    impact_index: category.impact_index,
    impact_id: category.method_id,
    impact_version: category.method_version,
    status: category.status,
    reasons: category.reasons,
    value: category.status === 'available' ? 0 : null,
  }));
  expect(() => validateLciaQueryRows(undefined, receipt)).toThrow('lcia_availability_axis_invalid');
  expect(() => validateLciaQueryRows([null, rows[1]], receipt)).toThrow(
    'lcia_availability_row_invalid',
  );
  expect(() => validateLciaQueryRows([rows[0], rows[0]], receipt)).toThrow(
    'lcia_availability_row_mismatch',
  );
});

it('binds single-category queries to disposition, selected IDs and finite ranking fields', () => {
  const category = receipt.categories[0];
  const selected = {
    impact_id: category.method_id,
    impact_index: category.impact_index,
    kind: 'selected_processes',
    values: { 'process-1': 0 },
  };
  expect(() => validateLciaImpactQueryData(selected, receipt.categories[1], ['process-1'])).toThrow(
    'lcia_availability_row_mismatch',
  );
  expect(() =>
    validateLciaImpactQueryData(
      { ...selected, impact_id: receipt.categories[1].method_id, impact_index: 1 },
      receipt.categories[1],
      ['process-1'],
    ),
  ).toThrow('lcia_category_unavailable');
  for (const data of [
    { ...selected, impact_version: '02.00.000' },
    { ...selected, reasons: ['not_applicable'] },
  ])
    expect(() => validateLciaImpactQueryData(data, category, ['process-1'])).toThrow(
      'lcia_availability_row_mismatch',
    );
  expect(() =>
    validateLciaImpactQueryData({ ...selected, kind: 'ranked_processes' }, category, ['process-1']),
  ).toThrow('lcia_availability_values_invalid');

  const ranked = {
    ...selected,
    kind: 'ranked_processes',
    offset: 0,
    limit: 10,
    returned_count: 1,
    total_process_count: 1,
    total_absolute_value: 2,
    values: [
      {
        process_id: 'process-1',
        process_version: '01.00.000',
        process_index: 0,
        value: -2,
        absolute_value: 2,
      },
    ],
  };
  for (const data of [
    { ...ranked, offset: -1 },
    { ...ranked, limit: 0 },
    { ...ranked, returned_count: 2 },
    { ...ranked, total_absolute_value: -1 },
    { ...ranked, values: [{ ...ranked.values[0], status: 'unavailable' }] },
    { ...ranked, values: [{ ...ranked.values[0], reasons: ['not_applicable'] }] },
  ])
    expect(() => validateLciaImpactQueryData(data, category)).toThrow(
      'lcia_availability_values_invalid',
    );
});

it('requires modern bundle extents while retaining validated historical numeric records', () => {
  const row = {
    processIndex: 0,
    method: { id: receipt.categories[0].method_id, version: '01.00.000' },
    meanAmount: 0,
  };
  expect(() => validateBundleLciaRows([row])).not.toThrow();
  expect(() => validateBundleLciaRows([row], receipt)).toThrow(
    'lcia_artifact_process_extent_missing',
  );
  const extent = {
    firstProcessIndex: 0,
    lastProcessIndex: 0,
    recordCount: 2,
    selectedProcessIndex: 0,
    processCount: 1,
  };
  const rows = receipt.categories.map((category) => ({
    processIndex: 0,
    method: { id: category.method_id, version: category.method_version },
    meanAmount: category.status === 'available' ? 0 : null,
    status: category.status,
    reasons: category.reasons,
  }));
  expect(() =>
    validateBundleLciaRows([{ ...rows[0], processIndex: -1 }, rows[1]], receipt, extent),
  ).toThrow('lcia_artifact_process_extent_invalid');
  expect(() => validateBundleLciaRows([rows[0], rows[0]], receipt, extent)).toThrow(
    'lcia_availability_axis_invalid',
  );
  expect(() =>
    validateBundleLciaRows(
      [rows[0], { ...rows[1], method: { ...rows[1].method, version: '02.00.000' } }],
      receipt,
      extent,
    ),
  ).toThrow('lcia_availability_row_mismatch');
  expect(() =>
    validateBundleLciaRows([rows[0], { ...rows[1], reasons: ['different'] }], receipt, extent),
  ).toThrow('lcia_availability_row_mismatch');
  expect(() =>
    validateBundleLciaRows([row], undefined, {
      ...extent,
      lastProcessIndex: 1,
      processCount: 2,
      recordCount: 1,
      selectedProcessIndex: 1,
    }),
  ).toThrow('lcia_artifact_process_cardinality_mismatch');

  const complete: LciaAvailability = {
    ...receipt,
    completeness: 'complete',
    categories: receipt.categories.map((category) => ({
      ...category,
      status: 'available',
      reasons: [],
    })),
  };
  expect(() =>
    validateBundleLciaRows(
      complete.categories.map((category) => ({
        ...row,
        method: { id: category.method_id, version: category.method_version },
      })),
      complete,
      extent,
    ),
  ).not.toThrow();
});
