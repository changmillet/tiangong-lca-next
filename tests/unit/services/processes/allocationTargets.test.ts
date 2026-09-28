import {
  verifyAllocationProducts,
  verifyAllocationProductProblems,
} from '@/services/processes/allocationTargets';
type ProcessExchangeData = import('@/services/processes/data').ProcessExchangeData;

const mockGetFlowProperties = jest.fn();
jest.mock('@/services/flows/api', () => ({
  getFlowProperties: (...args: unknown[]) => mockGetFlowProperties(...args),
}));
const fixture = (): ProcessExchangeData[] => [
  {
    '@dataSetInternalID': '1',
    exchangeDirection: 'Output',
    referenceToFlowDataSet: { '@refObjectId': 'flow', '@version': '1' },
  },
  {
    '@dataSetInternalID': '2',
    exchangeDirection: 'Input',
    allocations: {
      allocation: { '@internalReferenceToCoProduct': '1', '@allocatedFraction': '100' },
    },
  },
];
beforeEach(() => mockGetFlowProperties.mockReset());

it('does not query for undeclared or historical allocation and rejects incomplete declarations first', async () => {
  expect(await verifyAllocationProducts([])).toBeUndefined();
  expect(
    await verifyAllocationProducts([
      { ...fixture()[0], allocations: { allocation: { '@allocatedFraction': '100' } } },
    ]),
  ).toBeUndefined();
  expect(await verifyAllocationProducts([fixture()[1]])).toBe('target');
  expect(mockGetFlowProperties).not.toHaveBeenCalled();
});

it('verifies exact product revisions and prevents a target changed into an elementary flow', async () => {
  mockGetFlowProperties.mockResolvedValue({
    success: true,
    data: [{ id: 'flow', version: '1', typeOfDataSet: 'Product flow' }],
  });
  expect(await verifyAllocationProducts(fixture())).toBeUndefined();
  expect(mockGetFlowProperties).toHaveBeenCalledWith([{ id: 'flow', version: '1' }]);
  for (const data of [
    [],
    [{ id: 'flow', version: '2', typeOfDataSet: 'Product flow' }],
    [{ id: 'flow', version: '1', typeOfDataSet: 'Elementary flow' }],
  ]) {
    mockGetFlowProperties.mockResolvedValue({ data });
    expect(await verifyAllocationProducts(fixture())).toBe('target');
  }
  mockGetFlowProperties.mockRejectedValue(new Error('offline'));
  expect(await verifyAllocationProducts(fixture())).toBe('target');
});

it('supports array references and refuses missing reference identity', async () => {
  const rows = fixture();
  rows[0].referenceToFlowDataSet = [{ '@refObjectId': 'flow', '@version': '1' }];
  mockGetFlowProperties.mockResolvedValue({
    data: [{ id: 'flow', version: '1', typeOfDataSet: 'Product flow' }],
  });
  expect(await verifyAllocationProducts(rows)).toBeUndefined();
  rows[0].referenceToFlowDataSet = undefined;
  expect(await verifyAllocationProducts(rows)).toBe('target');
});

it('reports every dependent exchange when the exact target is invalid or unverifiable', async () => {
  const rows = [...fixture(), { ...fixture()[1], '@dataSetInternalID': '3' }];
  mockGetFlowProperties.mockResolvedValue({ data: [] });
  expect(await verifyAllocationProductProblems(rows)).toEqual([
    { code: 'target', exchangeId: '2', targetIds: ['1'] },
    { code: 'target', exchangeId: '3', targetIds: ['1'] },
  ]);
  mockGetFlowProperties.mockResolvedValue(undefined);
  expect((await verifyAllocationProductProblems(rows)).map((issue) => issue.code)).toEqual([
    'unverified',
    'unverified',
  ]);
});
