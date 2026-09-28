import { ContactForm } from '@/pages/Contacts/Components/form';
import type { ContactDataSetObjectKeys, FormContact } from '@/services/contacts/data';
import { genContactFromData } from '@/services/contacts/util';
import { initVersion } from '@/services/general/data';
import { formatDateTime, getLang, getLangText } from '@/services/general/util';
import {
  activateReviewerContact,
  type ReviewerContactStatus,
} from '@/services/reviewerContacts/api';
import { CloseOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { ProForm, type ProFormInstance } from '@ant-design/pro-components';
import { App, Alert, Button, Card, Descriptions, Drawer, Space, Spin } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'umi';
import { v4 } from 'uuid';

type Props = {
  status: ReviewerContactStatus | null;
  loading: boolean;
  error: any;
  onRefresh: () => Promise<unknown>;
};

const ReviewerProfile = ({ status, loading, error, onRefresh }: Props) => {
  const { message, modal } = App.useApp();
  const intl = useIntl();
  const lang = getLang(intl.locale);
  const formRef = useRef<ProFormInstance | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTabKey, setActiveTabKey] = useState<ContactDataSetObjectKeys>('contactInformation');
  const [formData, setFormData] = useState<FormContact>();
  const creatingVersion = Boolean(status?.contact);
  const contactId = useMemo(() => status?.contact?.['@refObjectId'] ?? v4(), [status?.contact]);
  const contactName = getLangText(
    status?.dataset?.json_ordered?.contactDataSet?.contactInformation?.dataSetInformation?.[
      'common:name'
    ],
    lang,
  );

  const buildInitialData = () => {
    if (status?.dataset?.json_ordered?.contactDataSet) {
      return genContactFromData(status.dataset.json_ordered.contactDataSet);
    }
    const ownerRef = {
      '@refObjectId': contactId,
      '@type': 'contact data set',
      '@uri': `../contacts/${contactId}.xml`,
      '@version': initVersion,
      'common:shortDescription': [],
    };
    return {
      contactInformation: { dataSetInformation: {} },
      administrativeInformation: {
        dataEntryBy: { 'common:timeStamp': formatDateTime(new Date()) },
        publicationAndOwnership: {
          'common:dataSetVersion': initVersion,
          'common:permanentDataSetURI': intl.formatMessage({
            id: 'pages.contact.permanentDataSetURI.default',
            defaultMessage: 'Automatically generated',
          }),
          'common:referenceToOwnershipOfDataSet': ownerRef,
        },
      },
    } as unknown as FormContact;
  };

  useEffect(() => {
    if (!open) return;
    const initialData = buildInitialData();
    setFormData(initialData);
    formRef.current?.resetFields();
    formRef.current?.setFieldsValue(initialData);
  }, [open, status?.dataset?.version]);

  const openVersionEditor = () => {
    modal.confirm({
      title: intl.formatMessage({
        id: 'pages.review.reviewerProfile.versionRequired.title',
        defaultMessage: 'Create a new version to update',
      }),
      content: intl.formatMessage({
        id: 'pages.review.reviewerProfile.versionRequired.content',
        defaultMessage:
          'The current reviewer profile is open data and cannot be edited directly. A new version will be created.',
      }),
      onOk: () => setOpen(true),
    });
  };

  const activate = async (bind: boolean) => {
    setSaving(true);
    try {
      const values = formRef.current?.getFieldsValue();
      const result = await activateReviewerContact({
        mode: creatingVersion ? 'createVersion' : 'create',
        id: contactId,
        sourceVersion: status?.contact?.['@version'],
        formData: values,
        bind,
        expectedContact: status?.contact ?? null,
      });
      if (result.error || result.data?.ok === false) {
        message.error(
          result.error?.message ??
            result.data?.message ??
            intl.formatMessage({ id: 'pages.action.error', defaultMessage: 'Action failed' }),
        );
        return;
      }
      message.success(
        intl.formatMessage({
          id: bind
            ? 'pages.review.reviewerProfile.publishBindSuccess'
            : 'pages.review.reviewerProfile.publishOnlySuccess',
          defaultMessage: bind
            ? 'Reviewer profile published and bound.'
            : 'New version published. The previous version remains bound.',
        }),
      );
      setOpen(false);
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    await formRef.current?.validateFields();
    if (creatingVersion) {
      modal.confirm({
        closable: false,
        keyboard: false,
        mask: { closable: false },
        title: intl.formatMessage({
          id: 'pages.review.reviewerProfile.bindVersion.title',
          defaultMessage: 'Bind the new version?',
        }),
        content: intl.formatMessage({
          id: 'pages.review.reviewerProfile.bindVersion.content',
          defaultMessage:
            'After publishing, do you want to use the new version as your current reviewer profile?',
        }),
        okText: intl.formatMessage({
          id: 'pages.review.reviewerProfile.publishAndBind',
          defaultMessage: 'Publish and bind',
        }),
        cancelText: intl.formatMessage({
          id: 'pages.review.reviewerProfile.publishOnly',
          defaultMessage: 'Publish only',
        }),
        onOk: () => activate(true),
        onCancel: () => activate(false),
      });
      return;
    }
    modal.confirm({
      title: intl.formatMessage({
        id: 'pages.review.reviewerProfile.openData.title',
        defaultMessage: 'Publish reviewer profile',
      }),
      content: intl.formatMessage({
        id: 'pages.review.reviewerProfile.openData.content',
        defaultMessage:
          'After validation, this profile will be published as open data and bound to your reviewer account.',
      }),
      onOk: () => activate(true),
    });
  };

  if (loading) return <Spin />;
  if (error) {
    return (
      <Alert
        type='error'
        showIcon
        title={<FormattedMessage id='pages.review.reviewerProfile.loadError' />}
        action={
          <Button onClick={onRefresh}>
            <FormattedMessage id='pages.review.reviewerProfile.retry' defaultMessage='Retry' />
          </Button>
        }
      />
    );
  }

  return (
    <>
      <Card
        title={<FormattedMessage id='pages.review.reviewerProfile.title' />}
        extra={
          <Button
            type='primary'
            icon={status?.contact ? <EditOutlined /> : <PlusOutlined />}
            onClick={status?.contact ? openVersionEditor : () => setOpen(true)}
          >
            <FormattedMessage
              id={
                status?.contact
                  ? 'pages.review.reviewerProfile.update'
                  : 'pages.review.reviewerProfile.create'
              }
            />
          </Button>
        }
      >
        {status?.status !== 'ready' && (
          <Alert
            type='warning'
            showIcon
            title={<FormattedMessage id='pages.review.reviewerProfile.required' />}
            style={{ marginBottom: 16 }}
          />
        )}
        {status?.contact && (
          <Descriptions
            column={1}
            items={[
              {
                key: 'contactName',
                label: <FormattedMessage id='pages.review.reviewerProfile.contactName' />,
                children: contactName,
              },
              {
                key: 'contactId',
                label: <FormattedMessage id='pages.review.reviewerProfile.contactId' />,
                children: status.contact['@refObjectId'],
              },
              {
                key: 'version',
                label: <FormattedMessage id='pages.review.reviewerProfile.version' />,
                children: status.contact['@version'],
              },
              {
                key: 'state',
                label: <FormattedMessage id='pages.review.reviewerProfile.state' />,
                children: status.ready
                  ? intl.formatMessage({ id: 'pages.review.reviewerProfile.ready' })
                  : intl.formatMessage({ id: 'pages.review.reviewerProfile.invalid' }),
              },
            ]}
          />
        )}
      </Card>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        closable={false}
        mask={{ closable: false }}
        destroyOnHidden
        size='90%'
        title={
          <FormattedMessage
            id={
              creatingVersion
                ? 'pages.review.reviewerProfile.update'
                : 'pages.review.reviewerProfile.create'
            }
          />
        }
        extra={<Button icon={<CloseOutlined />} type='text' onClick={() => setOpen(false)} />}
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setOpen(false)}>
              <FormattedMessage id='pages.button.cancel' />
            </Button>
            <Button type='primary' loading={saving} onClick={submit}>
              <FormattedMessage id='pages.review.reviewerProfile.validateAndPublish' />
            </Button>
          </Space>
        }
      >
        <Spin spinning={saving}>
          <ProForm<FormContact>
            formRef={formRef}
            initialValues={formData}
            submitter={false}
            onValuesChange={(_, values) => setFormData(values as FormContact)}
          >
            <ContactForm
              formType={creatingVersion ? 'createVersion' : 'create'}
              lang={lang}
              activeTabKey={activeTabKey}
              formRef={formRef}
              onData={() => setFormData(formRef.current?.getFieldsValue() as FormContact)}
              onTabChange={(key) => setActiveTabKey(key as ContactDataSetObjectKeys)}
              showRules
              lockOwnership
            />
          </ProForm>
        </Spin>
      </Drawer>
    </>
  );
};

export default ReviewerProfile;
