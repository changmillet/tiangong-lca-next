import { getFlowProperties } from '@/services/flows/api';
import { getLangText } from '@/services/general/util';
import {
  allocationEntries,
  isLegacyAllocation,
  type AllocationValue,
} from '@/services/processes/allocation';
import type { ProcessExchangeData } from '@/services/processes/data';
import { Alert, Button, InputNumber, Select, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useIntl } from 'umi';

export const exchangeLabel = (exchange: ProcessExchangeData, lang: string): string => {
  const reference = Array.isArray(exchange.referenceToFlowDataSet)
    ? exchange.referenceToFlowDataSet[0]
    : exchange.referenceToFlowDataSet;
  return `${getLangText(reference?.['common:shortDescription'], lang)} (#${exchange['@dataSetInternalID']})`;
};

export const useAllocationTargets = (exchanges: ProcessExchangeData[], lang: string) => {
  const intl = useIntl();
  const [targets, setTargets] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Bind both source and result to exact Flow revisions. getFlowProperties may
  // offer a latest-version fallback; that fallback must never authorize a target.
  const key = JSON.stringify(
    exchanges
      .filter((exchange) => exchange.exchangeDirection?.toUpperCase() === 'OUTPUT')
      .map((exchange) => {
        const ref = Array.isArray(exchange.referenceToFlowDataSet)
          ? exchange.referenceToFlowDataSet[0]
          : exchange.referenceToFlowDataSet;
        return {
          value: String(exchange['@dataSetInternalID']),
          label: exchange.quantitativeReference
            ? `${exchangeLabel(exchange, lang)} · ${intl.formatMessage({
                id: 'pages.process.exchange.quantitativeReference',
                defaultMessage: 'Quantitative reference',
              })}`
            : exchangeLabel(exchange, lang),
          id: ref?.['@refObjectId'],
          version: ref?.['@version'],
        };
      }),
  );
  useEffect(() => {
    let active = true;
    setTargets([]);
    setLoading(true);
    setFailed(false);
    const outputs = JSON.parse(key) as Array<{
      value: string;
      label: string;
      id?: string;
      version?: string;
    }>;
    const refs = outputs.filter((output) => output.id && output.version) as Array<{
      value: string;
      label: string;
      id: string;
      version: string;
    }>;
    if (!refs.length) {
      setLoading(false);
      return;
    }
    getFlowProperties(refs)
      .then((result) => {
        if (!active) return;
        setTargets(
          refs
            .filter((ref) =>
              result?.data?.some(
                (flow: { id: string; version: string; typeOfDataSet: string }) =>
                  flow.id === ref.id &&
                  flow.version === ref.version &&
                  flow.typeOfDataSet === 'Product flow',
              ),
            )
            .map(({ value, label }) => ({ value, label })),
        );
        setFailed(!result?.success);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [key]);
  return { targets, loading, failed };
};

type Props = {
  value?: AllocationValue;
  onChange?: (value: AllocationValue) => void;
  targets: Array<{ value: string; label: string }>;
  loading?: boolean;
  failed?: boolean;
};

export default function AllocationEditor({ value, onChange, targets, loading, failed }: Props) {
  const intl = useIntl();
  const entries = allocationEntries(value);
  const update = (index: number, field: string, next: unknown) => {
    onChange?.(
      entries.map((entry, position) =>
        position === index ? { ...entry, [field]: next } : { ...entry },
      ),
    );
  };
  return (
    <Space orientation='vertical' style={{ width: '100%' }}>
      <Typography.Text type='secondary'>
        {intl.formatMessage({
          id: 'pages.process.allocation.default',
          defaultMessage:
            'Without an allocation, this exchange belongs entirely to the reference product.',
        })}
      </Typography.Text>
      {isLegacyAllocation(value) && (
        <Alert
          type='warning'
          title={intl.formatMessage({
            id: 'pages.process.allocation.legacy',
            defaultMessage:
              'Legacy product shares are preserved. Convert all affected exchanges together before using target allocations.',
          })}
        />
      )}
      {failed && (
        <Alert
          type='error'
          title={intl.formatMessage({
            id: 'pages.process.allocation.loadFailed',
            defaultMessage: 'Product targets could not be verified. Reopen to retry.',
          })}
        />
      )}
      {entries.map((entry, index) => {
        const target = entry['@internalReferenceToCoProduct'];
        const options = [...targets];
        if (target !== undefined && !options.some((option) => option.value === String(target)))
          options.push({
            value: String(target),
            label: intl.formatMessage(
              {
                id: 'pages.process.allocation.unresolved',
                defaultMessage: 'Unverified target #{id}',
              },
              { id: target },
            ),
          });
        return (
          <Space key={index} wrap style={{ width: '100%' }}>
            <Select
              aria-label={intl.formatMessage({
                id: 'pages.process.allocation.target',
                defaultMessage: 'Target product',
              })}
              style={{ minWidth: 210 }}
              loading={loading}
              value={target === undefined ? undefined : String(target)}
              options={options}
              showSearch={{ optionFilterProp: 'label' }}
              onChange={(next) => update(index, '@internalReferenceToCoProduct', next)}
            />
            <InputNumber
              aria-label={intl.formatMessage({
                id: 'pages.process.view.exchange.allocatedFraction',
                defaultMessage: 'Allocated fraction',
              })}
              min='0'
              max='100'
              precision={3}
              stringMode
              suffix='%'
              value={
                entry['@allocatedFraction'] === undefined
                  ? null
                  : String(entry['@allocatedFraction']).replace('%', '')
              }
              onChange={(next) => update(index, '@allocatedFraction', next ?? undefined)}
            />
            <Button
              onClick={() => {
                const next = entries.filter((_, position) => position !== index);
                onChange?.(next.length ? next : undefined);
              }}
            >
              {intl.formatMessage({ id: 'pages.button.delete', defaultMessage: 'Delete' })}
            </Button>
          </Space>
        );
      })}
      <Button disabled={loading || !targets.length} onClick={() => onChange?.([...entries, {}])}>
        {intl.formatMessage({
          id: 'pages.process.allocation.add',
          defaultMessage: 'Add product allocation',
        })}
      </Button>
    </Space>
  );
}
