import { useUpdateReferenceContext } from '@/contexts/updateReferenceContext';
import { getSourceDetail } from '@/services/sources/api';
import { genSourceFromData } from '@/services/sources/util';
import { ProFormInstance } from '@ant-design/pro-components';
import { FormattedMessage } from '@umijs/max';
import { Button, Card, Col, Divider, Form, Input, Row, Space, theme } from 'antd';
import React, { FC, ReactNode, useEffect, useState } from 'react';
import SourceView from '../view';
import SourceSelectDrawer from './drawer';
import { validateRefObjectId } from '@/pages/Utils';
const { TextArea } = Input;

type Props = {
  parentName?: any;
  name: any;
  label: ReactNode | string;
  lang: string;
  formRef: React.MutableRefObject<ProFormInstance | undefined>;
  onData: () => void;
  rules?: any[];
  defaultSourceName?: string;
};

const SourceSelectForm: FC<Props> = ({
  parentName,
  name,
  label,
  lang,
  formRef,
  onData,
  rules = [],
  defaultSourceName
}) => {
  const [id, setId] = useState<string | undefined>(undefined);
  const [version, setVersion] = useState<string | undefined>(undefined);
  const { token } = theme.useToken();
  const { referenceValue } = useUpdateReferenceContext() as { referenceValue: number };

  const handletSourceData = (rowId: string, rowVersion: string) => {
    getSourceDetail(rowId, rowVersion).then(async (result: any) => {
      const selectedData = genSourceFromData(result.data?.json?.sourceDataSet ?? {});
      if (parentName) {
        await formRef.current?.setFieldValue([...parentName, ...name], {
          '@refObjectId': rowId,
          '@type': 'source data set',
          '@uri': `../sources/${rowId}.xml`,
          '@version': result.data?.version,
          'common:shortDescription':
            selectedData?.sourceInformation?.dataSetInformation?.['common:shortName'] ?? [],
        });
      } else {
        await formRef.current?.setFieldValue(name, {
          '@refObjectId': rowId,
          '@type': 'source data set',
          '@uri': `../sources/${rowId}.xml`,
          '@version': result.data?.version,
          'common:shortDescription':
            selectedData?.sourceInformation?.dataSetInformation?.['common:shortName'] ?? [],
        });
      }
      setId(rowId);
      setVersion(result.data?.version);
      validateRefObjectId(formRef, parentName, name);
      onData();
    });
  };

  // const id = formRef.current?.getFieldValue([...name, '@refObjectId']);
  useEffect(() => {
    if (id) {
      handletSourceData(id, version ?? '');
    }
  }, [referenceValue]);

  const getDefaultValue = () => {
    if (defaultSourceName === 'ILCD') {
      console.log('ILCD')
      const referenceToDataSetFormatId = 'a97a0155-0234-4b87-b4ce-a45da52f2a40';
      getSourceDetail(referenceToDataSetFormatId, '').then(async (result2: any) => {
        const referenceToDataSetFormatData = genSourceFromData(
          result2.data?.json?.sourceDataSet ?? {},
        );
        const referenceToDataSetFormat = {
          '@refObjectId': referenceToDataSetFormatId,
          '@type': 'source data set',
          '@uri': `../sources/${referenceToDataSetFormatId}.xml`,
          '@version': result2.data?.version,
          'common:shortDescription':
            referenceToDataSetFormatData?.sourceInformation?.dataSetInformation?.[
            'common:shortName'
            ] ?? [],
        };
        const newData = {
          administrativeInformation: {
            dataEntryBy: {
              'common:referenceToDataSetFormat': referenceToDataSetFormat,
            },
          },
        };
        // formRef.current?.resetFields();
        const currentData = formRef.current?.getFieldsValue();
        formRef.current?.setFieldsValue({...currentData, ...newData});
      });
    }
  }

  useEffect(() => {
    if (defaultSourceName) {
      getDefaultValue()
    }
  },[defaultSourceName]);

  useEffect(() => {
    setId(undefined);
    if (parentName) {
      setId(formRef.current?.getFieldValue([...parentName, ...name, '@refObjectId']));
      setVersion(formRef.current?.getFieldValue([...parentName, ...name, '@version']));
    } else {
      setId(formRef.current?.getFieldValue([...name, '@refObjectId']));
      setVersion(formRef.current?.getFieldValue([...name, '@version']));
    }
  });

  return (
    <Card size="small" title={label}>
      <Space direction="horizontal">
        <Form.Item
          label={<FormattedMessage id="pages.source.refObjectId" defaultMessage="Ref object id" />}
          name={[...name, '@refObjectId']}
          rules={rules}
        >
          <Input disabled={true} style={{ width: '350px', color: token.colorTextDescription }} />
        </Form.Item>
        <Space direction="horizontal" style={{ marginTop: '6px' }}>
          {!id && <SourceSelectDrawer buttonType="text" lang={lang} onData={handletSourceData} />}
          {id && (
            <SourceSelectDrawer
              buttonType="text"
              buttonText={<FormattedMessage id="pages.button.reselect" defaultMessage="Reselect" />}
              lang={lang}
              onData={handletSourceData}
            />
          )}
          {id && (
            <Button
              onClick={() => {
                handletSourceData(id, version ?? '');
              }}
            >
              <FormattedMessage
                id="pages.button.updateReference"
                defaultMessage="Update reference"
              />
            </Button>
          )}
          {id && <SourceView lang={lang} id={id} version={version ?? ''} buttonType="text" />}
          {id && (
            <Button
              onClick={() => {
                formRef.current?.setFieldValue([...name], {});
                onData();
                validateRefObjectId(formRef, parentName, name);
              }}
            >
              <FormattedMessage id="pages.button.clear" defaultMessage="Clear" />
            </Button>
          )}
        </Space>
      </Space>
      <Form.Item
        label={<FormattedMessage id="pages.contact.type" defaultMessage="Type" />}
        name={[...name, '@type']}
      >
        <Input disabled={true} style={{ color: token.colorTextDescription }} />
      </Form.Item>
      <Form.Item
        label={<FormattedMessage id="pages.contact.uri" defaultMessage="URI" />}
        name={[...name, '@uri']}
      >
        <Input disabled={true} style={{ color: token.colorTextDescription }} />
      </Form.Item>
      <Form.Item
        label={<FormattedMessage id="pages.contact.version" defaultMessage="Version" />}
        name={[...name, '@version']}
      >
        <Input disabled={true} style={{ color: token.colorTextDescription }} />
      </Form.Item>
      <Divider orientationMargin="0" orientation="left" plain>
        <FormattedMessage id="pages.contact.shortDescription" defaultMessage="Short description" />
      </Divider>
      <Form.Item>
        <Form.List name={[...name, 'common:shortDescription']}>
          {(subFields) => (
            <div style={{ display: 'flex', flexDirection: 'column', rowGap: 16 }}>
              {subFields.map((subField) => (
                <Row key={subField.key}>
                  <Col flex="100px" style={{ marginRight: '10px' }}>
                    <Form.Item noStyle name={[subField.name, '@xml:lang']}>
                      <Input
                        disabled={true}
                        style={{ width: '100px', color: token.colorTextDescription }}
                      />
                    </Form.Item>
                  </Col>
                  <Col flex="auto" style={{ marginRight: '10px' }}>
                    <Form.Item noStyle name={[subField.name, '#text']}>
                      <TextArea
                        placeholder="text"
                        rows={1}
                        disabled={true}
                        style={{ color: token.colorTextDescription }}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              ))}
              {subFields.length < 1 && <Input disabled={true} />}
            </div>
          )}
        </Form.List>
      </Form.Item>
    </Card>
  );
};

export default SourceSelectForm;
