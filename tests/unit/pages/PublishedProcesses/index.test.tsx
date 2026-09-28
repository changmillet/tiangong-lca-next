import PublishedProcesses from '@/pages/PublishedProcesses';
import { act, render, screen } from '@testing-library/react';

const mockGetProcessTableAll = jest.fn();
let proTableProps: any;

jest.mock('@/services/processes/api', () => ({
  getProcessTableAll: (...args: any[]) => mockGetProcessTableAll(...args),
}));

jest.mock('@ant-design/pro-components', () => ({
  PageContainer: ({ children, ...props }: any) => (
    <main data-testid='page-container' {...props}>
      {children}
    </main>
  ),
  ProTable: (props: any) => {
    proTableProps = props;
    return (
      <section data-testid='published-processes-table'>
        {props.headerTitle}
        {props.columns.map((column: any) => (
          <span key={String(column.dataIndex ?? column.valueType)}>{column.title}</span>
        ))}
      </section>
    );
  },
}));

jest.mock('antd', () => ({
  Typography: {
    Text: ({ children }: any) => <span>{children}</span>,
    Title: ({ children }: any) => <h2>{children}</h2>,
  },
}));

jest.mock('umi', () => ({
  FormattedMessage: ({ defaultMessage }: { defaultMessage: string }) => <>{defaultMessage}</>,
  useIntl: () => ({ locale: 'zh-CN' }),
}));

describe('PublishedProcesses', () => {
  beforeEach(() => {
    mockGetProcessTableAll.mockReset();
    proTableProps = undefined;
  });

  it('renders the URL-only published-process list without query controls', () => {
    render(<PublishedProcesses />);

    expect(screen.getByText('Published processes')).toBeInTheDocument();
    expect(screen.queryByText('Open Data')).not.toBeInTheDocument();
    expect(
      screen.queryByText('View published processes and their calculation results'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Process name')).toBeInTheDocument();
    expect(screen.getByText('Calculation result')).toBeInTheDocument();
    expect(proTableProps.className).toBe('responsive-data-list-table');
    expect(proTableProps.search).toBe(false);
    expect(proTableProps.options).toEqual({ fullScreen: true });
    expect(proTableProps.toolBarRender()).toEqual([]);
    expect(proTableProps.pagination).toEqual({ pageSize: 10, showSizeChanger: false });
    expect(proTableProps.columns[0].width).toBe(72);
    expect(proTableProps.columns[2].render()).toBeNull();
    expect(proTableProps.rowKey({ id: 'process-id', version: '01.00.000' })).toBe(
      'process-id:01.00.000',
    );
  });

  it('loads only published open-data processes', async () => {
    const result = { data: [], success: true, total: 0 };
    mockGetProcessTableAll.mockResolvedValue(result);
    render(<PublishedProcesses />);

    await expect(act(() => proTableProps.request({ current: 2, pageSize: 10 }))).resolves.toEqual(
      result,
    );
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
  });
});
