export const ErrorHint = {
  RETRY: 'RETRY',
  RE_LOGIN: 'RE_LOGIN',
  UPGRADE: 'UPGRADE',
  UPDATE_PAYMENT: 'UPDATE_PAYMENT',
  CONTACT_SUPPORT: 'CONTACT_SUPPORT',
  VERIFY_EMAIL: 'VERIFY_EMAIL',
  COMPLETE_PROFILE: 'COMPLETE_PROFILE',
  LINK_GUARDIAN: 'LINK_GUARDIAN',
} as const;

export type ErrorHint = (typeof ErrorHint)[keyof typeof ErrorHint];
