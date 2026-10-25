import {
  finiteLciaValue,
  normalizeLciaValueRow,
  parseLciaAvailability,
  validateBundleLciaRows,
  validateLciaQueryRows,
  type LciaAvailability,
} from '@/services/lca/categoryAvailability';

const receipt: LciaAvailability = {
  schema_version: 'lcia.category-availability.v1',
  policy_version: 'lcia.applicability.source-bound.v2',
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
