import AllocationBatch from '@/pages/Processes/Components/Exchange/allocationBatch';
import AllocationField from '@/pages/Processes/Components/Exchange/allocationField';
import AllocationEditor, {
  useAllocationTargets,
} from '@/pages/Processes/Components/Exchange/allocationEditor';
type AllocationEntry = {
  '@internalReferenceToCoProduct'?: string | number;
  '@allocatedFraction'?: string | number;
};
type AllocationValue = AllocationEntry | AllocationEntry[] | undefined;

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Form } from 'antd';
import { useState } from 'react';

const mockGetFlowProperties = jest.fn();
jest.mock('@/services/flows/api', () => ({
  getFlowProperties: (...args: unknown[]) => mockGetFlowProperties(...args),
}));
jest.mock('umi', () => ({
  useIntl: () => ({
    formatMessage: (
      { defaultMessage }: { defaultMessage: string },
      values: Record<string, unknown> = {},
    ) =>
      Object.entries(values).reduce(
        (message, [key, value]) => message.split(`{${key}}`).join(String(value)),
        defaultMessage,
      ),
  }),
}));

const product = (id: string) => ({
  '@dataSetInternalID': id,
  exchangeDirection: 'Output',
  referenceToFlowDataSet: {
    '@refObjectId': `flow-${id}`,
    '@version': '1',
    'common:shortDescription': [{ '@xml:lang': 'en', '#text': `Product ${id}` }],
  },
});
const split = [
  { '@internalReferenceToCoProduct': '1', '@allocatedFraction': '70' },
  { '@internalReferenceToCoProduct': '2', '@allocatedFraction': '30' },
];
const products = [product('1'), product('2')];
beforeEach(() => {
  mockGetFlowProperties.mockReset().mockResolvedValue({
    success: true,
    data: products.map((_, index) => ({
      id: `flow-${index + 1}`,
      version: '1',
      typeOfDataSet: 'Product flow',
    })),
  });
});

const chooseTarget = async (index: number, name: string) => {
  fireEvent.mouseDown(screen.getAllByRole('combobox', { name: 'Target product' })[index]);
  fireEvent.click((await screen.findAllByText(name)).pop()!);
};

describe('allocation forms with real Ant Design controls', () => {
  it('submits two target rows without collapsing the Form value and rejects partial totals', async () => {
    const finish = jest.fn();
    render(
      <Form onFinish={finish} initialValues={{ allocations: { allocation: split } }}>
        <AllocationField exchanges={products} lang='en' />
        <button type='submit'>Save allocation</button>
      </Form>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add product allocation' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save allocation' }));
    await waitFor(() =>
      expect(finish).toHaveBeenCalledWith({ allocations: { allocation: split } }),
    );
    finish.mockClear();
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save allocation' }));
    await screen.findByText(/Check allocation targets and shares/);
    expect(finish).not.toHaveBeenCalled();
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '' } });
    expect(screen.getAllByRole('spinbutton')[1]).toHaveValue('');
  });

  it('edits, adds and removes rows without changing another row', async () => {
    const changed = jest.fn();
    function Editor() {
      const [value, setValue] = useState<AllocationValue>(split);
      return (
        <AllocationEditor
          value={value}
          onChange={(next) => {
            changed(next);
            setValue(next);
          }}
          targets={products.map((_, index) => ({
            value: String(index + 1),
            label: `Product ${index + 1}`,
          }))}
        />
      );
    }
    render(<Editor />);
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '0' } });
    expect(changed).toHaveBeenLastCalledWith([
      { ...split[0], '@allocatedFraction': '0' },
      split[1],
    ]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(changed).toHaveBeenLastCalledWith([split[1]]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(changed).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Add product allocation' }));
    await chooseTarget(0, 'Product 1');
    expect(changed).toHaveBeenLastCalledWith([{ '@internalReferenceToCoProduct': '1' }]);
  });

  it('batch fill preserves configured rows, cancellation is non-mutating, replacement is explicit', async () => {
    const apply = jest.fn();
    const exchanges = [
      ...products,
      { '@dataSetInternalID': '3', exchangeDirection: 'Input', allocations: { allocation: split } },
    ];
    render(<AllocationBatch exchanges={exchanges} lang='en' onData={apply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Batch allocation' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add product allocation' })).toBeEnabled(),
    );
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByText('3 selected · 2 to update · 1 skipped')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add product allocation' }));
    await chooseTarget(0, 'Product 1 (#1)');
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0][0][2]).toBe(exchanges[2]);
    expect(apply.mock.calls[0][0][0].allocations.allocation).toEqual([
      { '@internalReferenceToCoProduct': '1', '@allocatedFraction': '100' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Batch allocation' }));
    await screen.findByText('Fill unconfigured exchanges only');
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('radio', { name: 'Replace selected allocations' }));
    expect(screen.getByText('3 selected · 3 to update · 0 skipped')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('excludes elementary flows and fallback versions and discards stale lookups', async () => {
    let resolveOld!: (value: unknown) => void;
    mockGetFlowProperties.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    function Targets({ exchanges }: { exchanges: ReturnType<typeof product>[] }) {
      const state = useAllocationTargets(exchanges, 'en');
      return <div data-testid='targets'>{JSON.stringify(state)}</div>;
    }
    const { rerender } = render(<Targets exchanges={[product('1')]} />);
    mockGetFlowProperties.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'flow-2', version: '1', typeOfDataSet: 'Elementary flow' },
        { id: 'flow-3', version: '2', typeOfDataSet: 'Product flow' },
      ],
    });
    rerender(<Targets exchanges={[product('2'), product('3')]} />);
    await waitFor(() => expect(screen.getByTestId('targets')).toHaveTextContent('"loading":false'));
    resolveOld({
      success: true,
      data: [{ id: 'flow-1', version: '1', typeOfDataSet: 'Product flow' }],
    });
    await waitFor(() => expect(screen.getByTestId('targets')).toHaveTextContent('"targets":[]'));
  });
});

it('preserves legacy values, shows unresolved targets and handles an unavailable product catalog', async () => {
  const finish = jest.fn();
  const { unmount } = render(
    <Form
      onFinish={finish}
      initialValues={{ allocations: { allocation: { '@allocatedFraction': '100%' } } }}
    >
      <AllocationField exchanges={[]} lang='en' allowLegacy />
      <button type='submit'>Save legacy</button>
    </Form>,
  );
  expect(screen.getByText(/Legacy product shares are preserved/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add product allocation' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save legacy' }));
  await waitFor(() => expect(finish).toHaveBeenCalled());
  unmount();
  mockGetFlowProperties.mockRejectedValueOnce(new Error('offline'));
  const failure = render(
    <Form
      initialValues={{
        allocations: {
          allocation: { '@internalReferenceToCoProduct': '99', '@allocatedFraction': '100' },
        },
      }}
    >
      <AllocationField exchanges={products} lang='en' />
    </Form>,
  );
  await screen.findByText('Product targets could not be verified. Reopen to retry.');
  expect(screen.getByText('Unverified target #99')).toBeInTheDocument();
  failure.unmount();
  mockGetFlowProperties.mockResolvedValueOnce(undefined);
  render(
    <Form>
      <AllocationField exchanges={products} lang='en' />
    </Form>,
  );
  await screen.findByText('Product targets could not be verified. Reopen to retry.');
});

it('rejects a mixed-mode batch atomically, then replaces all selected legacy shares', async () => {
  const apply = jest.fn();
  const exchanges = [
    { ...products[0], allocations: { allocation: { '@allocatedFraction': '100' } } },
    products[1],
  ];
  render(<AllocationBatch exchanges={exchanges} lang='en' onData={apply} />);
  fireEvent.click(screen.getByRole('button', { name: 'Batch allocation' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Add product allocation' })).toBeEnabled(),
  );
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Add product allocation' }));
  await chooseTarget(0, 'Product 1 (#1)');
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await screen.findByText(/Check allocation targets and shares/);
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('radio', { name: 'Replace selected allocations' }));
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(
    apply.mock.calls[0][0].every(
      (row: { allocations: { allocation: AllocationEntry[] } }) =>
        row.allocations.allocation[0]['@internalReferenceToCoProduct'] === '1',
    ),
  ).toBe(true);
});

it('does not fetch unresolved references and accepts an empty allocation without inventing shares', async () => {
  const finish = jest.fn();
  render(
    <Form onFinish={finish}>
      <AllocationField
        exchanges={[
          { '@dataSetInternalID': '1', exchangeDirection: 'Output', referenceToFlowDataSet: [] },
          { '@dataSetInternalID': '2' },
        ]}
        lang='en'
      />
      <button type='submit'>Save default</button>
    </Form>,
  );
  expect(mockGetFlowProperties).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save default' }));
  await waitFor(() =>
    expect(finish).toHaveBeenCalledWith({ allocations: { allocation: undefined } }),
  );
});
