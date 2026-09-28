import {
  allocationEntries,
  allocationDependents,
  nextExchangeId,
  canRetainAllocationDraft,
  collectAllocationProblems,
  applyBatchAllocation,
  hasAllocation,
  isLegacyAllocation,
  normalizeAllocation,
  validateAllocation,
  validateProcessAllocations,
} from '@/services/processes/allocation';
import type { ProcessExchangeData } from '@/services/processes/data';

const split = [
  { '@internalReferenceToCoProduct': '1', '@allocatedFraction': '70' },
  { '@internalReferenceToCoProduct': '2', '@allocatedFraction': '30' },
];
const targets = new Set(['1', '2']);
const products: ProcessExchangeData[] = [
  { '@dataSetInternalID': '1', exchangeDirection: 'Output', quantitativeReference: true },
  { '@dataSetInternalID': '2', exchangeDirection: 'Output' },
];

describe('Process allocation authoring contract', () => {
  it('preserves multiple targets, zero shares and single-object legacy shape', () => {
    expect(
      normalizeAllocation([
        { '@internalReferenceToCoProduct': 1, '@allocatedFraction': 0 },
        { '@internalReferenceToCoProduct': '2', '@allocatedFraction': '100%' },
      ]),
    ).toEqual([
      { '@internalReferenceToCoProduct': '1', '@allocatedFraction': '0' },
      { '@internalReferenceToCoProduct': '2', '@allocatedFraction': '100' },
    ]);
    expect(normalizeAllocation({ '@allocatedFraction': '70%' })).toEqual({
      '@allocatedFraction': '70',
    });
    expect(normalizeAllocation(undefined)).toBeUndefined();
    expect(allocationEntries({})).toEqual([]);
    expect(hasAllocation({ '@allocatedFraction': undefined })).toBe(false);
  });

  it.each([
    [split, undefined],
    [undefined, undefined],
    [[{ '@internalReferenceToCoProduct': '1', '@allocatedFraction': '100' }], undefined],
    [[{ '@internalReferenceToCoProduct': '1', '@allocatedFraction': '70' }], 'total'],
    [[{ '@internalReferenceToCoProduct': '3', '@allocatedFraction': '100' }], 'target'],
    [[split[0], split[0]], 'duplicate'],
    [[{ '@internalReferenceToCoProduct': '1', '@allocatedFraction': '-1' }], 'fraction'],
    [[{ '@internalReferenceToCoProduct': '1', '@allocatedFraction': '101' }], 'fraction'],
    [[{ '@internalReferenceToCoProduct': '1', '@allocatedFraction': 'NaN' }], 'fraction'],
    [[{ '@internalReferenceToCoProduct': '1' }], 'fraction'],
    [[{}], 'target'],
  ])('validates explicit vector %j', (value, issue) => {
    expect(validateAllocation(value, targets)).toBe(issue);
  });

  it('keeps default attribution empty without creating legacy output shares', () => {
    const before = JSON.stringify(products);
    expect(validateProcessAllocations(products)).toBeUndefined();
    expect(JSON.stringify(products)).toBe(before);
    expect(isLegacyAllocation(undefined)).toBe(false);
  });

  it('does not aggregate independent targeted vectors across outputs', () => {
    expect(
      validateProcessAllocations(
        products.map((product) => ({ ...product, allocations: { allocation: split } })),
      ),
    ).toBeUndefined();
    expect(
      validateProcessAllocations([
        { ...products[0], allocations: { allocation: [split[0]] } },
        products[1],
      ]),
    ).toBe('total');
  });

  it('preserves legacy output shares and rejects mixed mode and input legacy shares', () => {
    const legacy = products.map((product, index) => ({
      ...product,
      allocations: { allocation: { '@allocatedFraction': index ? '30%' : '70%' } },
    }));
    expect(validateProcessAllocations(legacy)).toBeUndefined();
    expect(
      validateProcessAllocations([
        legacy[0],
        { ...products[1], allocations: { allocation: split } },
      ]),
    ).toBe('mixed');
    expect(validateProcessAllocations([{ ...legacy[0], exchangeDirection: 'Input' }])).toBe(
      'legacyInput',
    );
    expect(validateProcessAllocations([legacy[0]])).toBe('total');
    expect(
      validateProcessAllocations(
        products.map((product, index) => ({
          ...product,
          allocations: { allocation: { '@allocatedFraction': index ? 40 : 60 } },
        })),
      ),
    ).toBeUndefined();
    expect(
      validateProcessAllocations([{ ...products[0], allocations: { allocation: [{}] } }]),
    ).toBe('fraction');
    expect(
      validateProcessAllocations([
        { ...products[0], allocations: { allocation: { '@allocatedFraction': 'bad' } } },
      ]),
    ).toBe('fraction');
  });

  it('fills only empty selected rows, supports explicit replacement, and never mutates source', () => {
    const different = [{ '@internalReferenceToCoProduct': '1', '@allocatedFraction': '100' }];
    const source = [
      ...products,
      { '@dataSetInternalID': '3', exchangeDirection: 'Input', meanAmount: '100' },
      {
        '@dataSetInternalID': '4',
        exchangeDirection: 'Input',
        allocations: { allocation: different },
      },
      { '@dataSetInternalID': '5', exchangeDirection: 'Input' },
    ];
    const snapshot = JSON.stringify(source);
    const selected = new Set(['3', '4']);
    const filled = applyBatchAllocation(source, selected, split, 'empty', targets);
    expect(filled[2].allocations?.allocation).toEqual(split);
    expect(filled[3]).toBe(source[3]);
    expect(filled[4]).toBe(source[4]);
    expect(
      applyBatchAllocation(source, selected, split, 'replace', targets)[3].allocations?.allocation,
    ).toEqual(split);
    expect(JSON.stringify(source)).toBe(snapshot);
    expect(() => applyBatchAllocation(source, selected, [split[0]], 'replace', targets)).toThrow(
      'total',
    );
    expect(() => applyBatchAllocation(source, selected, undefined, 'replace', targets)).toThrow(
      'target',
    );
    const legacy = [
      { ...products[0], allocations: { allocation: { '@allocatedFraction': '100' } } },
      products[1],
      source[2],
    ];
    expect(() => applyBatchAllocation(legacy, new Set(['3']), split, 'empty', targets)).toThrow(
      'mixed',
    );
  });
});

it('reserves existing identities and dangling targets when adding exchanges', () => {
  const rows = [
    {
      '@dataSetInternalID': '0',
      allocations: {
        allocation: [{ '@internalReferenceToCoProduct': '1', '@allocatedFraction': '100' }],
      },
    },
  ];
  expect(nextExchangeId(rows)).toBe('2');
  expect(nextExchangeId([])).toBe('0');
  expect(allocationDependents(rows, '1')).toEqual(rows);
  expect(allocationDependents(rows, '0')).toEqual([]);
  expect(collectAllocationProblems(rows)).toEqual([
    { code: 'target', exchangeId: '0', targetIds: ['1'] },
  ]);
});

it('allows only unchanged inherited allocation structure to be retained as a repairable draft', () => {
  const original = [
    {
      '@dataSetInternalID': '0',
      exchangeDirection: 'Output',
      quantitativeReference: true,
      referenceToFlowDataSet: [{ '@refObjectId': 'a', '@version': '1' }],
      allocations: { allocation: { '@allocatedFraction': '70%' } },
    },
  ];
  expect(canRetainAllocationDraft(original, [{ ...original[0], meanAmount: '12' }])).toBe(true);
  expect(canRetainAllocationDraft(undefined, original)).toBe(false);
  expect(canRetainAllocationDraft([], original)).toBe(false);
  expect(canRetainAllocationDraft(original, [{ ...original[0], allocations: undefined }])).toBe(
    false,
  );
  expect(
    canRetainAllocationDraft(original, [
      { ...original[0], referenceToFlowDataSet: { '@refObjectId': 'b', '@version': '1' } },
    ]),
  ).toBe(false);
  expect(
    canRetainAllocationDraft(original, [{ ...original[0], referenceToFlowDataSet: undefined }]),
  ).toBe(false);
  expect(canRetainAllocationDraft(original, [])).toBe(false);
});
