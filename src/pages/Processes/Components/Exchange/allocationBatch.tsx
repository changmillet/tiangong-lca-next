import {
  applyBatchAllocation,
  hasAllocation,
  type AllocationValue,
} from '@/services/processes/allocation';
import type { ProcessExchangeData } from '@/services/processes/data';
import { Alert, Button, Modal, Radio, Space, Table } from 'antd';
import { useState } from 'react';
import { useIntl } from 'umi';
import AllocationEditor, { exchangeLabel, useAllocationTargets } from './allocationEditor';

function BatchDialog({
  exchanges,
  lang,
  onApply,
  onCancel,
}: {
  exchanges: ProcessExchangeData[];
  lang: string;
  onApply: (data: ProcessExchangeData[]) => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [value, setValue] = useState<AllocationValue>();
  const [mode, setMode] = useState<'empty' | 'replace'>('empty');
  const [error, setError] = useState(false);
  const { targets, loading, failed } = useAllocationTargets(exchanges, lang);
  const selectedIds = new Set(selected.map(String));
  const changed = exchanges.filter(
    (exchange) =>
      selectedIds.has(String(exchange['@dataSetInternalID'])) &&
      (mode === 'replace' || !hasAllocation(exchange.allocations?.allocation)),
  ).length;
  return (
    <Modal
      open
      width={760}
      title={intl.formatMessage({
        id: 'pages.process.allocation.batch',
        defaultMessage: 'Batch allocation',
      })}
      onCancel={onCancel}
      okButtonProps={{ disabled: loading || failed || !changed || !hasAllocation(value) }}
      onOk={() => {
        try {
          onApply(
            applyBatchAllocation(
              exchanges,
              selectedIds,
              value,
              mode,
              new Set(targets.map((target) => target.value)),
            ),
          );
        } catch {
          setError(true);
        }
      }}
    >
      <Space orientation='vertical' style={{ width: '100%' }}>
        <Table
          size='small'
          rowKey='@dataSetInternalID'
          dataSource={exchanges}
          pagination={{ pageSize: 10 }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: setSelected,
            preserveSelectedRowKeys: true,
          }}
          columns={[
            {
              title: intl.formatMessage({
                id: 'pages.process.allocation.exchanges',
                defaultMessage: 'Inputs / outputs',
              }),
              render: (_, exchange) => exchangeLabel(exchange, lang),
            },
          ]}
        />
        <Radio.Group
          value={mode}
          onChange={(event) => setMode(event.target.value)}
          options={[
            {
              value: 'empty',
              label: intl.formatMessage({
                id: 'pages.process.allocation.fill',
                defaultMessage: 'Fill unconfigured exchanges only',
              }),
            },
            {
              value: 'replace',
              label: intl.formatMessage({
                id: 'pages.process.allocation.replace',
                defaultMessage: 'Replace selected allocations',
              }),
            },
          ]}
        />
        <div>
          {intl.formatMessage(
            {
              id: 'pages.process.allocation.summary',
              defaultMessage: '{selected} selected · {changed} to update · {skipped} skipped',
            },
            { selected: selected.length, changed, skipped: selected.length - changed },
          )}
        </div>
        <AllocationEditor
          value={value}
          onChange={(next) => {
            setValue(next);
            setError(false);
          }}
          targets={targets}
          loading={loading}
          failed={failed}
        />
        {error && (
          <Alert
            type='error'
            title={intl.formatMessage({
              id: 'pages.process.allocation.invalid',
              defaultMessage:
                'Check allocation targets and shares: each explicit allocation must total 100%, and legacy shares cannot be mixed with targeted allocations.',
            })}
          />
        )}
      </Space>
    </Modal>
  );
}

export default function AllocationBatch({
  exchanges,
  lang,
  onData,
  disabled,
}: {
  exchanges: ProcessExchangeData[];
  lang: string;
  onData: (data: ProcessExchangeData[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const intl = useIntl();
  return (
    <>
      <Button disabled={disabled || !exchanges.length} onClick={() => setOpen(true)}>
        {intl.formatMessage({
          id: 'pages.process.allocation.batch',
          defaultMessage: 'Batch allocation',
        })}
      </Button>
      {open && (
        <BatchDialog
          exchanges={exchanges}
          lang={lang}
          onCancel={() => setOpen(false)}
          onApply={(data) => {
            onData(data);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
