export const ErrorHint = {
  RETRY: 'RETRY',
  RE_LOGIN: 'RE_LOGIN',
  UPGRADE: 'UPGRADE',
  UPDATE_PAYMENT: 'UPDATE_PAYMENT',
  CONTACT_SUPPORT: 'CONTACT_SUPPORT',
} as const;

export type ErrorHint = (typeof ErrorHint)[keyof typeof ErrorHint];
