import { FormattedMessage } from 'umi';

export const StringMultiLang_r = [
  {
    required: true,
    warningOnly: true,
    message: (
      <FormattedMessage
        id="validator.recommended.empty"
        defaultMessage="Recommended to fill in to enhance data detail and usability!"
      />
    ),
  },
  {
    max: 500,
    message: (
      <FormattedMessage
        id="validator.StringMultiLang.pattern"
        defaultMessage="Length cannot exceed 500 characters!"
      />
    ),
  },
];

export const StringMultiLang_o = [
  {
    required: true,
    warningOnly: true,
    message: (
      <FormattedMessage
        id="validator.optional.empty"
        defaultMessage="Optional to fill in, providing additional information without affecting completeness!"
      />
    ),
  },
  {
    max: 500,
    message: (
      <FormattedMessage
        id="validator.StringMultiLang.pattern"
        defaultMessage="Length cannot exceed 500 characters!"
      />
    ),
  },
];

export const STMultiLang_r = [
  {
    required: true,
    warningOnly: true,
    message: (
      <FormattedMessage
        id="validator.recommended.empty"
        defaultMessage="Recommended to fill in to enhance data detail and usability!"
      />
    ),
  },
  {
    max: 1000,
    message: (
      <FormattedMessage
        id="validator.STMultiLang.pattern"
        defaultMessage="Length cannot exceed 1000 characters!"
      />
    ),
  },
];

export const STMultiLang_o = [
  {
    required: true,
    warningOnly: true,
    message: (
      <FormattedMessage
        id="validator.optional.empty"
        defaultMessage="Optional to fill in, providing additional information without affecting completeness!"
      />
    ),
  },
  {
    max: 1000,
    message: (
      <FormattedMessage
        id="validator.STMultiLang.pattern"
        defaultMessage="Length cannot exceed 1000 characters!"
      />
    ),
  },
];

export const String_m = [
  {
    required: true,
    warningOnly: true,
    message: (
      <FormattedMessage
        id="validator.mandatory.empty"
        defaultMessage="Mandatory to fill in to ensure data set completeness and compliance!"
      />
    ),
  },
  {
    whitespace: true,
    min: 1,
    max: 500,
    message: (
      <FormattedMessage
        id="validator.String.pattern"
        defaultMessage="Length cannot be less than 1 or exceed 500 characters!"
      />
    ),
  },
];

export const String_r = [
  {
    required: true,
    warningOnly: true,
    message: (
      <FormattedMessage
        id="validator.recommended.empty"
        defaultMessage="Recommended to fill in to enhance data detail and usability!"
      />
    ),
  },
  {
    whitespace: true,
    min: 1,
    max: 500,
    message: (
      <FormattedMessage
        id="validator.String.pattern"
        defaultMessage="Length cannot be less than 1 or exceed 500 characters!"
      />
    ),
  },
];

export const String_o = [
  {
    required: true,
    warningOnly: true,
    message: (
      <FormattedMessage
        id="validator.optional.empty"
        defaultMessage="Optional to fill in, providing additional information without affecting completeness!"
      />
    ),
  },
  {
    whitespace: true,
    min: 1,
    max: 500,
    message: (
      <FormattedMessage
        id="validator.String.pattern"
        defaultMessage="Length cannot be less than 1 or exceed 500 characters!"
      />
    ),
  },
];

export const dataSetVersion = [
  {
    required: true,
    message: (
      <FormattedMessage
        id="validator.dataSetVersion.empty"
        defaultMessage="Please input the Data Set Version!"
      />
    ),
  },
  {
    pattern: /^\d{2}\.\d{2}\.\d{3}$/,
    message: (
      <FormattedMessage
        id="validator.dataSetVersion.pattern"
        defaultMessage="Version format must be XX.XX.XXX, where X is a digit!"
      />
    ),
  },
];

// export const emailvalidation = [
//   ...String_o,
//   {
//     type: 'email',
//     message: (
//       <FormattedMessage
//         id="validator.pages.contact.email.pattern"
//         defaultMessage="The input is not valid E-mail!"
//       />
//     ),
//   },
// ];

// export const WWWAddress = [
//   ...STMultiLang_r,
//   {
//     type: 'url',
//     warningOnly: true,
//     message: (
//       <FormattedMessage
//         id="validator.pages.contact.WWWAddress.invalid"
//         defaultMessage="Please enter a valid WWWAddress!"
//       />
//     ),
//   },
// ];

export const CASNumber = [
  {
    required: true,
    warningOnly: true,
    message: (
      <FormattedMessage
        id="validator.CASNumber.empty"
        defaultMessage="Should only be given for (virtually) pure substances, but NOT also for the main constituent of a material or product etc!"
      />
    ),
  },
  {
    pattern: /^\d{2,7}-\d{2}-\d$/,
    message: (
      <FormattedMessage
        id="validator.CASNumber.pattern"
        defaultMessage="CAS Number format must be XX-XX-X or XXXXXXX-XX-X, where X is a digit!"
      />
    ),
  },
];

export const NullableString = [
  {
    required: true,
    warningOnly: true,
    message: (
      <FormattedMessage
        id="validator.recommended.empty"
        defaultMessage="Recommended to fill in to enhance data detail and usability!"
      />
    ),
  },
  {
    type: 'string',
    max: 500,
    message: (
      <FormattedMessage
        id="validator.NullableString.pattern"
        defaultMessage="Length cannot exceed 500 characters characters and may be empty!"
      />
    ),
  },
];
