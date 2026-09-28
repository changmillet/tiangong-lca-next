import { allocationDependents } from '@/services/processes/allocation';
import { exchangeLabel } from './allocationEditor';
import { ProcessExchangeData } from '@/services/processes/data';
import { DeleteOutlined } from '@ant-design/icons';
import { Button, Modal, Tooltip, App } from 'antd';
import type { FC } from 'react';
import { useCallback, useState } from 'react';
import { FormattedMessage, useIntl } from 'umi';

type Props = {
  id: string;
  data: ProcessExchangeData[];
  buttonType: string;
  // actionRef: React.RefObject<ActionType | undefined>;
  setViewDrawerVisible: React.Dispatch<React.SetStateAction<boolean>>;
  onData: (data: ProcessExchangeData[]) => void;
  disabled?: boolean;
  lang?: string;
};

const ProcessExchangeDelete: FC<Props> = ({
  id,
  data,
  buttonType,
  // actionRef,
  setViewDrawerVisible,
  onData,
  disabled = false,
  lang = 'en',
}) => {
  const { message } = App.useApp();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const intl = useIntl();

  const showModal = useCallback(() => {
    setIsModalVisible(true);
  }, []);

  const handleOk = useCallback(() => {
    const affected = allocationDependents(data, id);
    if (affected.length) {
      message.error(
        `${intl.formatMessage({
          id: 'pages.process.allocation.deleteReferenced',
          defaultMessage:
            'This product is used by allocations. Update the following exchanges before deleting it:',
        })} ${affected.map((exchange) => exchangeLabel(exchange, lang)).join(', ')}`,
      );
      return;
    }
    onData(data.filter((item) => item['@dataSetInternalID'] !== id));
    message.success(
      intl.formatMessage({
        id: 'pages.button.delete.success',
        defaultMessage: 'Selected record has been deleted.',
      }),
    );
    setViewDrawerVisible(false);
    setIsModalVisible(false);
    // actionRef.current?.reload();
  }, [data, id, intl, lang, message, onData, setViewDrawerVisible]);

  const handleCancel = useCallback(() => {
    setIsModalVisible(false);
  }, []);

  return (
    <>
      <Tooltip title={<FormattedMessage id='pages.button.delete' defaultMessage='Delete' />}>
        {buttonType === 'icon' ? (
          <>
            <Button
              disabled={disabled}
              shape='circle'
              icon={<DeleteOutlined />}
              size='small'
              onClick={showModal}
            />
            <Modal
              title={<FormattedMessage id='pages.button.delete' defaultMessage='Delete' />}
              open={isModalVisible}
              onOk={handleOk}
              onCancel={handleCancel}
            >
              <FormattedMessage
                id='pages.button.delete.confirm'
                defaultMessage='Are you sure you want to delete this data?'
              />
            </Modal>
          </>
        ) : (
          <>
            <Button disabled={disabled} size='small' onClick={showModal}>
              <FormattedMessage id='pages.button.delete' defaultMessage='Delete' />
            </Button>
            <Modal
              title={<FormattedMessage id='pages.button.delete' defaultMessage='Delete' />}
              open={isModalVisible}
              onOk={handleOk}
              onCancel={handleCancel}
            >
              <FormattedMessage
                id='pages.button.delete.confirm'
                defaultMessage='Are you sure you want to delete this data?'
              />
            </Modal>
          </>
        )}{' '}
      </Tooltip>
    </>
  );
};

export default ProcessExchangeDelete;
