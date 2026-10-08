import { getLang } from '@/services/general/util';
import AlignedNumber from '@/components/AlignedNumber';
import type {
  PublishedLciaExactValue,
  PublishedLciaProcessSelection,
} from '@/services/dataProducts';
import {
  getPublishedClimateResults,
  publishedProcessKey,
} from '@/services/dataProducts/publishedClimate';
import { getProcessTableAll } from '@/services/processes/api';
import type { ProcessTable } from '@/services/processes/data';
import { dataListIndexColumn, responsiveDataListTableProps } from '@/components/ResponsiveDataList';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Space, Spin, Tooltip } from 'antd';
import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { FormattedMessage, useIntl } from 'umi';

type PublishedProcessTable = ProcessTable & {
  calculationResult?: string;
};

const PUBLISHED_PROCESS_FILTERS = {
  sourceFilter: 'all',
  publicationFilter: 'published',
} as const;

const PublishedProcesses: FC = () => {
  const intl = useIntl();
  const lang = getLang(intl.locale);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const [resultState, setResultState] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    values: Map<string, PublishedLciaExactValue>;
  }>({ status: 'idle', values: new Map() });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current += 1;
    };
  }, [intl.locale]);

  const loadResults = useCallback(
    async (processes: PublishedLciaProcessSelection[], token: number) => {
      setResultState({ status: processes.length ? 'loading' : 'idle', values: new Map() });
      if (!processes.length) return;
      try {
        const values = await getPublishedClimateResults(processes);
        if (mounted.current && epoch.current === token) setResultState({ status: 'ready', values });
      } catch {
        if (mounted.current && epoch.current === token)
          setResultState({ status: 'error', values: new Map() });
      }
    },
    [],
  );

  const requestProcesses = useCallback(
    async (params: { current?: number; pageSize?: number }) => {
      const token = ++epoch.current;
      setResultState({ status: 'loading', values: new Map() });
      const result = await getProcessTableAll(
        params,
        {},
        lang,
        'tg',
        [],
        undefined,
        'all',
        PUBLISHED_PROCESS_FILTERS,
      );
      if (mounted.current && epoch.current === token) {
        const processes = result.success
          ? result.data.map(({ id, version }) => ({ id, version }))
          : [];
        void loadResults(processes, token);
      }
      return result;
    },
    [lang, loadResults],
  );
  const columns: ProColumns<PublishedProcessTable>[] = [
    {
      align: 'center',
      search: false,
      ...dataListIndexColumn<PublishedProcessTable>(),
      title: <FormattedMessage id='pages.table.title.index' defaultMessage='Index' />,
      valueType: 'index',
    },
    {
      dataIndex: 'name',
      ellipsis: true,
      search: false,
      title: (
        <FormattedMessage
          id='pages.process.published.table.processName'
          defaultMessage='Process name'
        />
      ),
    },
    {
      dataIndex: 'calculationResult',
      search: false,
      title: (
        <FormattedMessage
          id='pages.process.published.table.calculationResult'
          defaultMessage='Calculation result'
        />
      ),
      width: '40%',
      render: (_, record) => {
        if (resultState.status === 'loading') return <Spin size='small' />;
        if (resultState.status === 'error')
          return (
            <FormattedMessage
              id='pages.process.published.climate.error'
              defaultMessage='Failed to load'
            />
          );
        const result = resultState.values.get(publishedProcessKey(record));
        if (!result || result.status === 'missing') {
          return (
            <Tooltip
              title={
                <FormattedMessage
                  id='pages.process.published.climate.missing'
                  defaultMessage='No result for this version in the current publication'
                />
              }
            >
              <span>—</span>
            </Tooltip>
          );
        }
        return (
          <Space>
            <AlignedNumber value={result.value} />
            <span>{result.unit}</span>
          </Space>
        );
      },
    },
  ];

  return (
    <PageContainer header={{ breadcrumb: {}, title: false }}>
      <ProTable<PublishedProcessTable>
        {...responsiveDataListTableProps}
        columns={columns}
        headerTitle={
          <FormattedMessage
            id='pages.process.published.title'
            defaultMessage='Published processes'
          />
        }
        options={{ fullScreen: true }}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        params={{ locale: intl.locale }}
        request={requestProcesses}
        rowKey={(record) => `${record.id}:${record.version}`}
        search={false}
      />
    </PageContainer>
  );
};

export default PublishedProcesses;
