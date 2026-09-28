import { addReviewMemberApi } from '@/services/roles/api';
import { getUserInfoByEmail } from '@/services/users/api';
import { FormattedMessage, useIntl } from '@umijs/max';
import { App, Form, Input, Modal } from 'antd';
import { useEffect, useState } from 'react';

interface AddMemberModalProps {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

const AddMemberModal: React.FC<AddMemberModalProps> = ({ open, onCancel, onSuccess }) => {
  const { message } = App.useApp();
  const intl = useIntl();
  const [form] = Form.useForm<{ email: string }>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) form.resetFields();
  }, [form, open]);

  const handleOk = async () => {
    const { email } = await form.validateFields();
    setLoading(true);
    try {
      const lookup = await getUserInfoByEmail(email);
      if (!lookup.success || !lookup.user?.id) {
        message.error(intl.formatMessage({ id: 'pages.review.members.userNotFound' }));
        return;
      }

      const result = await addReviewMemberApi(lookup.user.id);
      if (result?.error?.code === '23505') {
        message.error(intl.formatMessage({ id: 'pages.review.members.addError.duplicate' }));
        return;
      }
      if (!result?.success) {
        message.error(intl.formatMessage({ id: 'pages.review.members.addError' }));
        return;
      }

      message.success(intl.formatMessage({ id: 'pages.review.members.addSuccess' }));
      form.resetFields();
      onSuccess();
      onCancel();
    } catch (error) {
      console.error(error);
      message.error(intl.formatMessage({ id: 'pages.review.members.addError' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={<FormattedMessage id='pages.review.members.add' defaultMessage='Add Member' />}
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form form={form} layout='vertical'>
        <Form.Item
          name='email'
          label={<FormattedMessage id='pages.review.members.email' defaultMessage='Email' />}
          rules={[
            {
              required: true,
              message: intl.formatMessage({ id: 'pages.review.members.email.required' }),
            },
            {
              type: 'email',
              message: intl.formatMessage({ id: 'pages.review.members.email.invalid' }),
            },
          ]}
        >
          <Input
            autoComplete='off'
            placeholder={intl.formatMessage({ id: 'pages.review.members.email.placeholder' })}
            onPressEnter={handleOk}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default AddMemberModal;
