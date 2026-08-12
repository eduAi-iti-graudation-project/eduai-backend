export const JOIN_REQUEST_SOURCES = ['ROSTER', 'SELF'] as const;
export type JoinRequestSource = (typeof JOIN_REQUEST_SOURCES)[number];

export const JOIN_REQUEST_KINDS = ['STUDENT', 'GUARDIAN'] as const;
export type JoinRequestKind = (typeof JOIN_REQUEST_KINDS)[number];

export const JOIN_REQUEST_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
] as const;
export type JoinRequestStatus = (typeof JOIN_REQUEST_STATUSES)[number];
