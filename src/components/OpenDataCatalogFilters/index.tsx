import { AppstoreOutlined, BankOutlined, FileTextOutlined } from '@ant-design/icons';
import ToolBarButton from '@/components/ToolBarButton';
import {
  DEFAULT_OPEN_DATA_FILTERS,
  type OpenDataCatalogFilters as OpenDataCatalogFilterValue,
  type OpenDataPublicationFilter,
  type OpenDataSourceFilter,
} from '@/services/openDataCatalog/types';
import { Select, Space } from 'antd';
import type { FC, ReactNode } from 'react';
import { useIntl } from 'umi';

import './index.less';

type Props = {
  includePublication?: boolean;
  onChange: (filters: OpenDataCatalogFilterValue) => void;
  value?: OpenDataCatalogFilterValue;
};

const OpenDataCatalogFilters: FC<Props> = ({
  includePublication = false,
  onChange,
  value = DEFAULT_OPEN_DATA_FILTERS,
}) => {
  const intl = useIntl();
  const sourceOptions: Array<{
    icon: ReactNode;
    label: string;
    value: OpenDataSourceFilter;
  }> = [
    {
      value: 'all',
      label: intl.formatMessage({
        id: 'pages.openData.source.all',
        defaultMessage: 'All data',
      }),
      icon: <AppstoreOutlined />,
    },
    {
      value: 'enterprise',
      label: intl.formatMessage({
        id: 'pages.openData.source.enterprise',
        defaultMessage: 'Enterprise data',
      }),
      icon: <BankOutlined />,
    },
    {
      value: 'literature',
      label: intl.formatMessage({
        id: 'pages.openData.source.literature',
        defaultMessage: 'Literature data',
      }),
      icon: <FileTextOutlined />,
    },
  ];
  const publicationOptions: Array<{ label: string; value: OpenDataPublicationFilter }> = [
    {
      value: 'all',
      label: intl.formatMessage({
        id: 'pages.openData.publication.all',
        defaultMessage: 'All publication states',
      }),
    },
    {
      value: 'published',
      label: intl.formatMessage({
        id: 'pages.openData.publication.published',
        defaultMessage: 'Published',
      }),
    },
    {
      value: 'unpublished',
      label: intl.formatMessage({
        id: 'pages.openData.publication.unpublished',
        defaultMessage: 'Unpublished',
      }),
    },
  ];
  const sourceOptionIndex = sourceOptions.findIndex(
    (option) => option.value === value.sourceFilter,
  );
  const currentSourceOption = sourceOptions[sourceOptionIndex];
  const nextSourceOption =
    sourceOptions[(Math.max(sourceOptionIndex, 0) + 1) % sourceOptions.length];

  return (
    <Space size={8}>
      {includePublication && (
        <Select<OpenDataPublicationFilter>
          aria-label={intl.formatMessage({
            id: 'pages.openData.publication.filter',
            defaultMessage: 'Publication filter',
          })}
          value={value.publicationFilter ?? 'all'}
          options={publicationOptions}
          style={{ minWidth: 150 }}
          onChange={(publicationFilter) => onChange({ ...value, publicationFilter })}
        />
      )}
      <span className='tg-open-data-catalog-source-filter'>
        <ToolBarButton
          placement='option'
          icon={currentSourceOption.icon}
          tooltip={currentSourceOption.label}
          onClick={() => onChange({ ...value, sourceFilter: nextSourceOption.value })}
        />
      </span>
    </Space>
  );
};

export default OpenDataCatalogFilters;
