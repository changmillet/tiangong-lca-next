import PublishedProcesses from '@/pages/PublishedProcesses';
import { act, render, screen, within } from '@testing-library/react';

const mockGetProcessTableAll = jest.fn();
const mockGetClimate = jest.fn();
let mockLocale = 'zh-CN';
let mockSetRows: (rows: any[]) => void;
let proTableProps: any;

jest.mock('@/services/processes/api', () => ({
  getProcessTableAll: (...args: any[]) => mockGetProcessTableAll(...args),
}));
jest.mock('@/services/dataProducts/publishedClimate', () => ({
  getPublishedClimateResults: (...args: any[]) => mockGetClimate(...args),
  publishedProcessKey: ({ id, version }: any) => `${id}:${version}`,
}));
jest.mock('@ant-design/pro-components', () => ({
  PageContainer: ({ children }: any) => <main>{children}</main>,
  ProTable: (props: any) => {
    proTableProps = props;
    const [rows, setRows] = require('react').useState([]);
    mockSetRows = setRows;
    return (
      <section>
        {props.headerTitle}
        {props.columns.map((column: any) => (
          <span key={String(column.dataIndex ?? column.valueType)}>{column.title}</span>
        ))}
        {props.toolBarRender?.()}
        {rows.map((row: any) => (
          <article key={props.rowKey(row)} data-testid={props.rowKey(row)}>
            <span>{row.name}</span>
            {props.columns[2].render(null, row)}
          </article>
        ))}
      </section>
    );
  },
}));
jest.mock('umi', () => ({
  FormattedMessage: ({ defaultMessage, values = {} }: any) => (
    <>{defaultMessage.replace(/\{(\w+)\}/g, (_: string, key: string) => String(values[key]))}</>
  ),
  useIntl: () => ({ locale: mockLocale }),
}));
const process = (version = '01.00.000', id = 'process-a') => ({
  id,
  version,
  name: `${id} ${version}`,
});
const values = (rows: any[], value: number | null = 0) =>
  new Map(
    rows.map((row) => [
      `${row.id}:${row.version}`,
      {
        ...row,
        status: value === null ? 'missing' : 'available',
        value,
        unit: 'kg CO2 Equivalents',
      },
    ]),
  );
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function page(rows: any[], current = 1, success = true) {
  const result = { data: rows, success, total: rows.length };
  mockGetProcessTableAll.mockResolvedValueOnce(result);
  await act(async () => {
    expect(await proTableProps.request({ current, pageSize: 10 })).toEqual(result);
    mockSetRows(rows);
  });
}

describe('PublishedProcesses', () => {
  beforeEach(() => {
    mockGetProcessTableAll.mockReset();
    mockGetClimate.mockReset();
    mockLocale = 'zh-CN';
    proTableProps = undefined;
  });
  it('preserves published-only pagination, visibility and revision-qualified keys', async () => {
    render(<PublishedProcesses />);
    expect(screen.getByText('Published processes')).toBeInTheDocument();
    expect(screen.getByText('Calculation result (kg CO2 Equivalents)')).toBeInTheDocument();
    expect(proTableProps.className).toBe('responsive-data-list-table');
    expect(proTableProps.search).toBe(false);
    expect(proTableProps.options).toEqual({ fullScreen: true });
    expect(proTableProps.toolBarRender).toBeUndefined();
    expect(proTableProps.pagination).toEqual({ pageSize: 10, showSizeChanger: false });
    expect(proTableProps.columns[0].width).toBe(72);
    expect(proTableProps.rowKey(process())).toBe('process-a:01.00.000');
    await page([], 2);
    expect(mockGetProcessTableAll).toHaveBeenCalledWith(
      { current: 2, pageSize: 10 },
      {},
      'zh',
      'tg',
      [],
      undefined,
      'all',
      { publicationFilter: 'published', sourceFilter: 'all' },
    );
    expect(mockGetClimate).not.toHaveBeenCalled();
  });
  it('shows names while one batch is pending, then renders zero and another exact version independently', async () => {
    const pending = deferred<Map<string, any>>();
    mockGetClimate.mockReturnValueOnce(pending.promise);
    render(<PublishedProcesses />);
    const rows = [process(), process('01.00.001'), process('02.00.000')];
    await page(rows);
    expect(screen.getByText(rows[0].name)).toBeInTheDocument();
    expect(
      screen.getByTestId('process-a:01.00.000').querySelector('.ant-spin'),
    ).toBeInTheDocument();
    expect(mockGetClimate).toHaveBeenCalledTimes(1);
    expect(mockGetClimate).toHaveBeenCalledWith(rows.map(({ id, version }) => ({ id, version })));
    const result = values(rows);
    result.get('process-a:01.00.001')!.value = -0.125;
    result.get('process-a:01.00.001')!.unit = 'unknown';
    result.set('process-a:02.00.000', { ...rows[2], status: 'missing', value: null, unit: '' });
    await act(async () => pending.resolve(result));
    expect(within(screen.getByTestId('process-a:01.00.000')).getByText('0')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('process-a:01.00.001')).getByText('-0.125'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Calculation result (kg CO2 Equivalents)')).toHaveLength(1);
    expect(screen.queryByText('unknown')).not.toBeInTheDocument();
    for (const row of rows) {
      expect(screen.getByTestId(`${row.id}:${row.version}`)).not.toHaveTextContent(
        'kg CO2 Equivalents',
      );
    }
    expect(screen.getByTestId('process-a:02.00.000')).toHaveTextContent('—');
  });
  it('keeps the list on result failure without a retry button and recovers on standard refresh', async () => {
    mockGetClimate.mockRejectedValueOnce(new Error('offline'));
    render(<PublishedProcesses />);
    const rows = [process()];
    await page(rows);
    expect(screen.getByText(rows[0].name)).toBeInTheDocument();
    expect(screen.getByText('Failed to load')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry results' })).not.toBeInTheDocument();
    expect(mockGetClimate).toHaveBeenCalledTimes(1);
    mockGetClimate.mockResolvedValueOnce(values(rows, 1.25));
    await page(rows);
    expect(screen.getByText('1.25')).toBeInTheDocument();
    expect(mockGetProcessTableAll).toHaveBeenCalledTimes(2);
    expect(mockGetClimate).toHaveBeenCalledTimes(2);
  });
  it.each(['resolve', 'reject'] as const)(
    'ignores an old page batch that later %ss',
    async (outcome) => {
      const pending = deferred<Map<string, any>>();
      mockGetClimate.mockReturnValueOnce(pending.promise);
      render(<PublishedProcesses />);
      await page([process()]);
      const next = [process('01.00.001')];
      mockGetClimate.mockResolvedValueOnce(values(next, 3));
      await page(next, 2);
      await act(async () => {
        if (outcome === 'resolve') pending.resolve(values([process()], 99));
        else pending.reject(new Error('late'));
      });
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.queryByText('99')).not.toBeInTheDocument();
      expect(screen.queryByText('Failed to load')).not.toBeInTheDocument();
    },
  );
  it('does not launch a stale list response batch or failed-list batch', async () => {
    const pending = deferred<any>();
    mockGetProcessTableAll.mockReturnValueOnce(pending.promise);
    render(<PublishedProcesses />);
    let old!: Promise<any>;
    act(() => {
      old = proTableProps.request({ current: 1 });
    });
    mockGetClimate.mockResolvedValueOnce(values([process('01.00.001')], 2));
    await page([process('01.00.001')], 2);
    await act(async () => {
      pending.resolve({ data: [process()], success: true });
      await old;
    });
    expect(mockGetClimate).toHaveBeenCalledTimes(1);
    await page([process()], 3, false);
    expect(mockGetClimate).toHaveBeenCalledTimes(1);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
  it('ignores an old locale response and an unmounted response', async () => {
    const pending = deferred<Map<string, any>>();
    mockGetClimate.mockReturnValueOnce(pending.promise);
    const view = render(<PublishedProcesses />);
    await page([process()]);
    mockLocale = 'en-US';
    view.rerender(<PublishedProcesses />);
    mockGetClimate.mockResolvedValueOnce(values([process()], 7));
    await page([process()]);
    await act(async () => pending.resolve(values([process()], 99)));
    expect(screen.getByText('7')).toBeInTheDocument();
    const unmounted = deferred<Map<string, any>>();
    mockGetClimate.mockReturnValueOnce(unmounted.promise);
    await page([process()], 2);
    view.unmount();
    await act(async () => unmounted.resolve(values([process()], 9)));
  });
});
