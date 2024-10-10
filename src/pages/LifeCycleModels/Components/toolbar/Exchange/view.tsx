import LangTextItemDescription from '@/components/LangTextItem/description';
import FlowsSelectDescription from '@/pages/Flows/Components/select/description';
import { getProcessDetail } from '@/services/processes/api';
import { genProcessFromData } from '@/services/processes/util';
import {
  CheckCircleTwoTone,
  CloseCircleOutlined,
  CloseOutlined,
  ProfileOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Descriptions, Divider, Drawer, Row, Spin, Tooltip } from 'antd';
import type { FC } from 'react';
import { useState } from 'react';
import { FormattedMessage } from 'umi';

type Props = {
  lang: string;
  buttonType: string;
  sourceProcessId: string;
  targetProcessId: string;
  sourceOutputFlowInternalID: string;
  targetInputFlowInternalID: string;
};
const EdgeExchangeView: FC<Props> = ({
  lang,
  buttonType,
  sourceProcessId,
  targetProcessId,
  sourceOutputFlowInternalID,
  targetInputFlowInternalID,
}) => {
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [exchangeDataSource, setExchangeDataSource] = useState<any>({});
  const [exchangeDataTarget, setExchangeDataTarget] = useState<any>({});
  const [spinningSource, setSpinningSource] = useState(false);
  const [spinningTarget, setSpinningTarget] = useState(false);

  const onView = () => {
    setDrawerVisible(true);
    setSpinningSource(true);
    setSpinningTarget(true);
    getProcessDetail(sourceProcessId).then(async (result) => {
      const sourceDatas = (
        genProcessFromData(result.data?.json?.processDataSet ?? {})?.exchanges?.exchange ?? []
      ).filter(
        (item: any) =>
          (item?.exchangeDirection).toLowerCase() === 'output' &&
          item?.['@dataSetInternalID'] === sourceOutputFlowInternalID,
      );
      if (sourceDatas.length > 0) {
        setExchangeDataSource(sourceDatas[0]);
      }
      setSpinningSource(false);
    });

    getProcessDetail(targetProcessId).then(async (result) => {
      const targetDatas = (
        genProcessFromData(result.data?.json?.processDataSet ?? {})?.exchanges?.exchange ?? []
      ).filter(
        (item: any) =>
          (item?.exchangeDirection).toLowerCase() === 'input' &&
          item?.['@dataSetInternalID'] === targetInputFlowInternalID,
      );
      if (targetDatas.length > 0) {
        setExchangeDataTarget(targetDatas[0]);
      }
      setSpinningTarget(false);
    });
  };

  return (
    <>
      <Tooltip title={<FormattedMessage id="pages.button.view" defaultMessage="View exchange" />}>
        {buttonType === 'icon' ? (
          <Button
            type="primary"
            icon={<ProfileOutlined />}
            size="small"
            style={{ boxShadow: 'none' }}
            onClick={onView}
          />
        ) : (
          <Button onClick={onView}>
            <FormattedMessage id="pages.button.view" defaultMessage="View" />
          </Button>
        )}
      </Tooltip>
      <Drawer
        title={
          <FormattedMessage
            id="pages.flow.model.drawer.title.edge.exchange.view"
            defaultMessage="View exchange relation"
          />
        }
        width="90%"
        closable={false}
        extra={
          <Button
            icon={<CloseOutlined />}
            style={{ border: 0 }}
            onClick={() => setDrawerVisible(false)}
          />
        }
        footer={false}
        maskClosable={true}
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Card
              title={
                <FormattedMessage
                  id="pages.flow.model.sourceOutputFlowName"
                  defaultMessage="Source process output flow"
                />
              }
              bordered={false}
            >
              <Spin spinning={spinningSource}>
                <Descriptions bordered size={'small'} column={1}>
                  <Descriptions.Item
                    key={0}
                    label={
                      <FormattedMessage
                        id="pages.process.view.exchange.exchangeDirection"
                        defaultMessage="Exchange direction"
                      />
                    }
                    labelStyle={{ width: '220px' }}
                  >
                    {exchangeDataSource.exchangeDirection ?? '-'}
                  </Descriptions.Item>
                </Descriptions>
                <br />
                <FlowsSelectDescription
                  title={
                    <FormattedMessage
                      id="pages.process.view.exchange.referenceToFlowDataSet"
                      defaultMessage="Flow"
                    />
                  }
                  data={exchangeDataSource.referenceToFlowDataSet ?? {}}
                  lang={lang}
                />
                <br />
                <Descriptions bordered size={'small'} column={1}>
                  <Descriptions.Item
                    key={0}
                    label={
                      <FormattedMessage
                        id="pages.process.view.exchange.meanAmount"
                        defaultMessage="Mean amount"
                      />
                    }
                    labelStyle={{ width: '220px' }}
                  >
                    {exchangeDataSource.meanAmount ?? '-'}
                  </Descriptions.Item>
                </Descriptions>
                <br />
                <Descriptions bordered size={'small'} column={1}>
                  <Descriptions.Item
                    key={0}
                    label={
                      <FormattedMessage
                        id="pages.process.view.exchange.resultingAmount"
                        defaultMessage="Resulting amount"
                      />
                    }
                    labelStyle={{ width: '220px' }}
                  >
                    {exchangeDataSource.resultingAmount ?? '-'}
                  </Descriptions.Item>
                </Descriptions>
                <br />
                <Descriptions bordered size={'small'} column={1}>
                  <Descriptions.Item
                    key={0}
                    label={
                      <FormattedMessage
                        id="pages.process.view.exchange.dataDerivationTypeStatus"
                        defaultMessage="Data derivation type / status"
                      />
                    }
                    labelStyle={{ width: '220px' }}
                  >
                    {exchangeDataSource.dataDerivationTypeStatus ?? '-'}
                  </Descriptions.Item>
                </Descriptions>

                <Divider orientationMargin="0" orientation="left" plain>
                  <FormattedMessage
                    id="pages.process.view.exchange.generalComment"
                    defaultMessage="Comment"
                  />
                </Divider>
                <LangTextItemDescription data={exchangeDataSource.generalComment} />
                <br />
                <Card
                  size="small"
                  title={
                    <FormattedMessage
                      id="pages.process.view.exchange.quantitativeReference"
                      defaultMessage="Quantitative reference"
                    />
                  }
                >
                  <Descriptions bordered size={'small'} column={1}>
                    <Descriptions.Item
                      key={0}
                      label={
                        <FormattedMessage
                          id="pages.process.view.exchange.referenceToReferenceFlow"
                          defaultMessage="Reference flow(s)"
                        />
                      }
                      labelStyle={{ width: '220px' }}
                    >
                      {exchangeDataSource.quantitativeReference ? (
                        <CheckCircleTwoTone twoToneColor="#52c41a" />
                      ) : (
                        <CloseCircleOutlined />
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                  <Divider orientationMargin="0" orientation="left" plain>
                    <FormattedMessage
                      id="pages.process.view.exchange.functionalUnitOrOther"
                      defaultMessage="Functional unit, Production period, or Other parameter"
                    />
                  </Divider>
                  <LangTextItemDescription data={exchangeDataSource.functionalUnitOrOther} />
                </Card>
              </Spin>
            </Card>
          </Col>
          <Col span={12}>
            <Card
              title={
                <FormattedMessage
                  id="pages.flow.model.targetInputFlowName"
                  defaultMessage="Target process input flow"
                />
              }
              bordered={false}
            >
              <Spin spinning={spinningTarget}>
                <Descriptions bordered size={'small'} column={1}>
                  <Descriptions.Item
                    key={0}
                    label={
                      <FormattedMessage
                        id="pages.process.view.exchange.exchangeDirection"
                        defaultMessage="Exchange direction"
                      />
                    }
                    labelStyle={{ width: '220px' }}
                  >
                    {exchangeDataTarget.exchangeDirection ?? '-'}
                  </Descriptions.Item>
                </Descriptions>
                <br />
                <FlowsSelectDescription
                  title={
                    <FormattedMessage
                      id="pages.process.view.exchange.referenceToFlowDataSet"
                      defaultMessage="Flow"
                    />
                  }
                  data={exchangeDataTarget.referenceToFlowDataSet ?? {}}
                  lang={lang}
                />
                <br />
                <Descriptions bordered size={'small'} column={1}>
                  <Descriptions.Item
                    key={0}
                    label={
                      <FormattedMessage
                        id="pages.process.view.exchange.meanAmount"
                        defaultMessage="Mean amount"
                      />
                    }
                    labelStyle={{ width: '220px' }}
                  >
                    {exchangeDataTarget.meanAmount ?? '-'}
                  </Descriptions.Item>
                </Descriptions>
                <br />
                <Descriptions bordered size={'small'} column={1}>
                  <Descriptions.Item
                    key={0}
                    label={
                      <FormattedMessage
                        id="pages.process.view.exchange.resultingAmount"
                        defaultMessage="Resulting amount"
                      />
                    }
                    labelStyle={{ width: '220px' }}
                  >
                    {exchangeDataTarget.resultingAmount ?? '-'}
                  </Descriptions.Item>
                </Descriptions>
                <br />
                <Descriptions bordered size={'small'} column={1}>
                  <Descriptions.Item
                    key={0}
                    label={
                      <FormattedMessage
                        id="pages.process.view.exchange.dataDerivationTypeStatus"
                        defaultMessage="Data derivation type / status"
                      />
                    }
                    labelStyle={{ width: '220px' }}
                  >
                    {exchangeDataTarget.dataDerivationTypeStatus ?? '-'}
                  </Descriptions.Item>
                </Descriptions>

                <Divider orientationMargin="0" orientation="left" plain>
                  <FormattedMessage
                    id="pages.process.view.exchange.generalComment"
                    defaultMessage="Comment"
                  />
                </Divider>
                <LangTextItemDescription data={exchangeDataTarget.generalComment} />
                <br />
                <Card
                  size="small"
                  title={
                    <FormattedMessage
                      id="pages.process.view.exchange.quantitativeReference"
                      defaultMessage="Quantitative reference"
                    />
                  }
                >
                  <Descriptions bordered size={'small'} column={1}>
                    <Descriptions.Item
                      key={0}
                      label={
                        <FormattedMessage
                          id="pages.process.view.exchange.referenceToReferenceFlow"
                          defaultMessage="Reference flow(s)"
                        />
                      }
                      labelStyle={{ width: '220px' }}
                    >
                      {exchangeDataTarget.quantitativeReference ? (
                        <CheckCircleTwoTone twoToneColor="#52c41a" />
                      ) : (
                        <CloseCircleOutlined />
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                  <Divider orientationMargin="0" orientation="left" plain>
                    <FormattedMessage
                      id="pages.process.view.exchange.functionalUnitOrOther"
                      defaultMessage="Functional unit, Production period, or Other parameter"
                    />
                  </Divider>
                  <LangTextItemDescription data={exchangeDataTarget.functionalUnitOrOther} />
                </Card>
              </Spin>
            </Card>
          </Col>
        </Row>

        {/* </Spin> */}
      </Drawer>
    </>
  );
};

export default EdgeExchangeView;