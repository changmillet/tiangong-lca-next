import { getLang } from '@/services/general/util';
import { getProcessTableAll } from '@/services/processes/api';
import type { ProcessTable } from '@/services/processes/data';
import { dataListIndexColumn, responsiveDataListTableProps } from '@/components/ResponsiveDataList';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import type { FC } from 'react';
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
      render: () => null,
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
        request={(params) =>
          getProcessTableAll(
            params,
            {},
            lang,
            'tg',
            [],
            undefined,
            'all',
            PUBLISHED_PROCESS_FILTERS,
          )
        }
        rowKey={(record) => `${record.id}:${record.version}`}
        search={false}
        toolBarRender={() => []}
      />
    </PageContainer>
  );
};

export default PublishedProcesses;
