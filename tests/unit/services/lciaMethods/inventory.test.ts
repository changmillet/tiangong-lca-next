import { webcrypto } from 'node:crypto';
import { classifyLciaInventory, resolveLciaFlowMetadata } from '@/services/lciaMethods/inventory';
import {
  isKnownEmptyLciaInventory,
  normalizeLciaInventoryClassification,
} from '@/services/lciaMethods/inventoryClassification';

const mockGetFlowProperties = jest.fn();
jest.mock('@/services/flows/api', () => ({
  getFlowProperties: (...args: unknown[]) => mockGetFlowProperties(...args),
}));

const elementary = '08a91e70-3ddc-11dd-923d-0050c2490048';
const product = '00000000-0000-0000-0000-000000000001';
const waste = '00000000-0000-0000-0000-000000000002';
function exchange(id: string, version = '03.00.004', direction = 'Output') {
  return {
    '@dataSetInternalID': id,
    referenceToFlowDataSet: { '@refObjectId': id, '@version': version },
    exchangeDirection: direction,
    meanAmount: '1',
  };
}

beforeAll(() =>
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }),
);
beforeEach(() => mockGetFlowProperties.mockReset());

it('uses authoritative exact Flow types to keep elementary inventory and exclude product/waste inputs and outputs', async () => {
  mockGetFlowProperties.mockResolvedValue({
    success: true,
    data: [
      { id: elementary, version: '03.00.004', typeOfDataSet: 'Elementary flow' },
      { id: product, version: '03.00.004', typeOfDataSet: 'Product flow' },
      { id: waste, version: '03.00.004', typeOfDataSet: 'Waste flow' },
    ],
  });
  const rows = [
    exchange(product),
    { ...exchange(elementary), quantitativeReference: true },
    exchange(product, '03.00.004', 'Input'),
    exchange(waste),
    exchange(waste, '03.00.004', 'Input'),
  ];
  const before = JSON.stringify(rows);
  const classified = await classifyLciaInventory(rows);
  expect(classified.exchanges).toEqual([rows[1]]);
  expect(classified.receipt).toMatchObject({
    exchange_count: 5,
    elementary_exchange_count: 1,
    non_elementary_exchange_count: 4,
    unresolved_exchange_count: 0,
  });
  expect(mockGetFlowProperties).toHaveBeenCalledWith(
    expect.arrayContaining([
      { id: elementary, version: '03.00.004' },
      { id: product, version: '03.00.004' },
      { id: waste, version: '03.00.004' },
    ]),
  );
  expect(mockGetFlowProperties.mock.calls[0][0]).toHaveLength(3);
  expect(JSON.stringify(rows)).toBe(before);
  expect(isKnownEmptyLciaInventory(classified.receipt)).toBe(false);
});

it('rejects the existing reader revision fallback even if another revision is product or waste', async () => {
  mockGetFlowProperties.mockResolvedValue({
    success: true,
    data: [{ id: product, version: '03.00.005', typeOfDataSet: 'Waste flow' }],
  });
  const classified = await classifyLciaInventory([
    exchange(product),
    exchange(product, '03.00.005'),
  ]);
  expect(classified.receipt).toMatchObject({
    elementary_exchange_count: 0,
    non_elementary_exchange_count: 1,
    unresolved_exchange_count: 1,
  });
  expect(classified.receipt.bindings.map((binding) => binding.type_of_dataset)).toEqual([
    'Unknown',
    'Waste flow',
  ]);
  expect(isKnownEmptyLciaInventory(classified.receipt)).toBe(false);
});

it('keeps absent, unknown and conflicting classification explicit instead of guessing from reference flags', async () => {
  for (const data of [
    [],
    [{ id: product, version: '03.00.004', typeOfDataSet: 'Unknown type' }],
    [
      { id: product, version: '03.00.004', typeOfDataSet: 'Product flow' },
      { id: product, version: '03.00.004', typeOfDataSet: 'Elementary flow' },
    ],
  ]) {
    mockGetFlowProperties.mockResolvedValue({ success: true, data });
    const classified = await classifyLciaInventory([
      { ...exchange(product), quantitativeReference: true },
    ]);
    expect(classified.receipt.unresolved_exchange_count).toBe(1);
    expect(classified.exchanges).toEqual([]);
    expect(isKnownEmptyLciaInventory(classified.receipt)).toBe(false);
  }
  mockGetFlowProperties.mockRejectedValue(new Error('read failed'));
  expect(
    (await classifyLciaInventory([exchange(elementary)])).receipt.unresolved_exchange_count,
  ).toBe(1);
});

it('requires exact reference versions and supports only an unambiguous singleton reference', async () => {
  const missingVersion = exchange(product);
  delete (missingVersion.referenceToFlowDataSet as any)['@version'];
  const ambiguous = {
    ...exchange(product),
    referenceToFlowDataSet: [
      exchange(product).referenceToFlowDataSet,
      exchange(elementary).referenceToFlowDataSet,
    ],
  };
  const classified = await classifyLciaInventory([missingVersion, ambiguous]);
  expect(classified.receipt.unresolved_exchange_count).toBe(2);
  expect(mockGetFlowProperties).not.toHaveBeenCalled();
});

it('reuses exact metadata and bounds deduplicated reads to four batches of at most100', async () => {
  const retained = [{ id: product, version: '03.00.004', typeOfDataSet: 'Product flow' }];
  expect(await resolveLciaFlowMetadata([exchange(product)], retained)).toEqual(retained);
  expect(mockGetFlowProperties).not.toHaveBeenCalled();
  let active = 0;
  let maximum = 0;
  mockGetFlowProperties.mockImplementation(async (refs: { id: string; version: string }[]) => {
    active++;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    active--;
    return {
      success: true,
      data: refs.map((ref) => ({ ...ref, typeOfDataSet: 'Elementary flow' })),
    };
  });
  const unique = Array.from({ length: 501 }, (_, index) =>
    exchange(`00000000-0000-0000-0000-${index.toString(16).padStart(12, '0')}`),
  );
  const metadata = await resolveLciaFlowMetadata([...unique, ...unique]);
  expect(metadata).toHaveLength(501);
  expect(mockGetFlowProperties).toHaveBeenCalledTimes(6);
  expect(mockGetFlowProperties.mock.calls.every(([refs]) => refs.length <= 100)).toBe(true);
  expect(maximum).toBeLessThanOrEqual(4);
});

it('refuses contradictory cached Flow classifications and accepts a singleton reference without mutation', async () => {
  const row = exchange(product);
  row.referenceToFlowDataSet = [row.referenceToFlowDataSet] as any;
  const classified = await classifyLciaInventory(
    [row],
    [
      { id: product, version: '03.00.004', typeOfDataSet: 'Product flow' },
      { id: product, version: '03.00.004', typeOfDataSet: 'Elementary flow' },
    ],
  );
  expect(classified.receipt.unresolved_exchange_count).toBe(1);
  expect(classified.exchanges).toEqual([]);
  expect(mockGetFlowProperties).not.toHaveBeenCalled();
  const unrelated = await classifyLciaInventory(
    [exchange(product)],
    [
      { id: product, version: '03.00.004', typeOfDataSet: 'Product flow' },
      { id: waste, version: '03.00.004', typeOfDataSet: 'Waste flow' },
    ],
  );
  expect(unrelated.receipt.non_elementary_exchange_count).toBe(1);
  for (const response of [
    { success: false, data: [] },
    { success: true, error: { message: 'denied' }, data: [] },
    { success: true, data: {} },
  ]) {
    mockGetFlowProperties.mockResolvedValue(response);
    expect(
      (await classifyLciaInventory([exchange(elementary)])).receipt.unresolved_exchange_count,
    ).toBe(1);
  }
});

it('recognizes a genuinely known empty elementary inventory but refuses malformed receipts', async () => {
  const classified = await classifyLciaInventory(
    [exchange(product)],
    [{ id: product, version: '03.00.004', typeOfDataSet: 'Product flow' }],
  );
  expect(isKnownEmptyLciaInventory(classified.receipt)).toBe(true);
  expect(
    normalizeLciaInventoryClassification({ ...classified.receipt, unresolved_exchange_count: 1 }),
  ).toBeNull();
  expect(
    normalizeLciaInventoryClassification({ ...classified.receipt, elementary_exchange_count: 1 }),
  ).toBeNull();
});
