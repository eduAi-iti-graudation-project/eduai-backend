import type { ErrorCode } from './codes';

/**
 * Friendly copy for legacy/unconverted exceptions that only carry a status
 * code (or Nest's generic class default like "Forbidden"). Phase B converts
 * throw sites to ApiError with their own copy; these remain the safety net.
 */
export const STATUS_FALLBACK_MESSAGES: Record<number, string> = {
  400: 'The request was invalid. Please check your input and try again.',
  401: 'Your session has expired. Please log in again.',
  402: 'An active subscription is required to access this resource.',
  403: "You don't have permission to do that.",
  404: 'This item could not be found. It may have been removed.',
  405: 'This action is not allowed.',
  406: 'The requested response format is not supported.',
  409: 'This action conflicts with existing data.',
  410: 'This resource is no longer available.',
  413: 'The uploaded content is too large.',
  415: 'This file type is not supported.',
  422: 'Some of the submitted data is invalid.',
  429: 'Too many requests. Please wait a moment and try again.',
  500: 'Something went wrong on our side. Please try again in a moment.',
};

export const CODE_FALLBACK_MESSAGES: Partial<Record<ErrorCode, string>> = {
  AUTH_INVALID_CREDENTIALS: 'The email or password is incorrect.',
  AUTH_EMAIL_TAKEN: 'An account with this email already exists.',
  AUTH_TOKEN_EXPIRED: 'Your session has expired. Please log in again.',
  AUTH_TOKEN_INVALID: 'Your session is no longer valid. Please log in again.',
  AUTH_USER_NOT_FOUND: 'This account could not be found.',
  AUTH_MISSING_HEADER: 'Please log in to continue.',
  AUTH_MISSING_CODE: 'The sign-in link was incomplete. Please try again.',
  AUTH_PROVIDER_DISABLED: 'This sign-in option is not enabled.',
  AUTH_OAUTH_EMAIL_MISSING:
    'The sign-in provider did not return an email address.',
  AUTH_OAUTH_REJECTED:
    'The sign-in provider did not complete the sign-in. Please try again.',
  AUTH_OAUTH_EXCHANGE_FAILED:
    'We could not complete the sign-in. Please try again.',
  AUTH_SIGNUP_FAILED: 'We could not create your account. Please try again.',
  AUTH_LOGIN_FAILED: 'We could not sign you in. Please try again.',
  AUTH_LOGOUT_FAILED: 'We could not sign you out. Please try again.',

  SUBSCRIPTION_REQUIRED:
    'Your organization needs an active subscription to continue using EduAI.',
  TIER_REQUIRED: 'This feature is not included in your current plan.',
  PLAN_NOT_AVAILABLE: 'This plan is not available for purchase right now.',
  BILLING_NO_SUBSCRIPTION:
    'Your organization has no active subscription to change.',
  BILLING_NO_ITEMS: 'Your subscription cannot be changed right now.',
  ORG_NOT_FOUND: 'Your organization could not be found.',
  INVITE_EMAIL_INVALID: 'That email address is not valid.',
  INVITE_EMAIL_TAKEN: 'A user with this email already exists.',
  INVITE_SEATS_FULL:
    'Your organization has reached its seat limit. Upgrade to invite more members.',
  JOIN_CODE_INVALID: 'This join code is not valid.',
  REQUEST_ALREADY_EXISTS:
    'A request for this account is already awaiting review.',
  REQUEST_NOT_FOUND: 'This membership request could not be found.',
  REQUEST_ALREADY_RESOLVED:
    'This membership request has already been reviewed.',
  WEBHOOK_INVALID_SIGNATURE: 'Invalid Stripe signature.',
  WEBHOOK_MISSING_PAYLOAD: 'Missing webhook payload or signature.',
  WEBHOOK_UNCONFIGURED: 'The webhook secret is not configured.',

  GRADE_LEVEL_NOT_FOUND: 'This grade level could not be found.',
  GRADE_LEVEL_CONFLICT: 'This grade level already exists.',
  SECTION_NOT_FOUND: 'This section could not be found.',
  SECTION_CONFLICT:
    'A section with this name already exists in this grade level.',
  COURSE_NOT_FOUND: 'This course could not be found.',
  COURSE_CONFLICT:
    'A course with this name already exists in this grade level.',
  OFFERING_NOT_FOUND: 'This course offering could not be found.',
  OFFERING_CONFLICT: 'This course is already offered in this section.',
  TEACHER_NOT_FOUND: 'This teacher could not be found.',
  ENROLLMENT_NOT_FOUND: 'This enrollment could not be found.',
  ALREADY_ENROLLED: 'You are already enrolled in this section.',

  QUIZ_NOT_FOUND: 'This quiz could not be found.',
  QUIZ_DRAFT_ONLY: 'Only draft quizzes can be published.',
  QUIZ_NOT_PUBLISHED: 'This quiz is not published yet.',
  QUIZ_ALREADY_ATTEMPTED: 'You have already taken this quiz.',
  ATTEMPT_NOT_FOUND: 'This quiz attempt could not be found.',
  ATTEMPT_ALREADY_SUBMITTED: 'This attempt has already been submitted.',
  ATTEMPT_NOT_IN_PROGRESS: 'This attempt is no longer in progress.',
  ATTEMPT_FORBIDDEN: 'You can only access your own quiz attempts.',
  QUIZ_ANSWER_NOT_FOUND: 'This quiz answer could not be found.',

  SUBMISSION_NOT_FOUND: 'This submission could not be found.',
  ASSIGNMENT_NOT_FOUND: 'This assignment could not be found.',
  ASSIGNMENT_ID_REQUIRED: 'Please select an assignment to submit to.',
  SUBMISSION_NO_TEXT: 'Your submission contained no readable text.',
  PDF_NO_TEXT: 'This PDF contained no extractable text.',
  INVALID_STATUS_TRANSITION: 'This submission cannot move to that state.',
  SCORE_NOT_FOUND: 'This grade could not be found.',

  RUBRIC_NOT_FOUND: 'This rubric could not be found.',
  RUBRIC_CRITERIA_NOT_FOUND: 'This rubric criterion could not be found.',
  MATERIAL_NOT_FOUND: 'This material could not be found.',
  FILE_NO_TEXT: 'The uploaded file contained no extractable text.',

  STUDENT_NOT_FOUND: 'This student could not be found.',
  GUARDIAN_NOT_FOUND: 'This guardian could not be found.',
  TEACHER_HAS_OFFERINGS:
    'This teacher still teaches courses. Reassign their course offerings before removing them.',

  NOTIFICATION_NOT_FOUND: 'This notification could not be found.',
  ALERT_NOT_FOUND: 'This alert could not be found.',
  REPORT_NOT_FOUND: 'This report could not be found.',

  THREAD_NOT_FOUND: 'This conversation could not be found.',
  THREAD_NOT_PARTICIPANT: 'You are not a participant in this conversation.',
  CHAT_FORBIDDEN: 'You cannot start a conversation with this person.',

  INSIGHTS_FORBIDDEN: 'You can only view your own insights.',
  INSIGHTS_STUDENT_NOT_FOUND: 'This student could not be found.',

  INTERACTION_NOT_FOUND: 'This interaction could not be found.',
  HOMEWORK_FORBIDDEN: 'You can only view your own homework help history.',
};

/** Nest's generic per-class default messages that carry no signal for users. */
export const GENERIC_BACKEND_MESSAGES = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Conflict',
  'Payment Required',
  'Internal Server Error',
  'Request Timeout',
  'Unprocessable Entity',
  'Too Many Requests',
  'Method Not Allowed',
  'Not Acceptable',
  'Unsupported Media Type',
  'Payload Too Large',
  'Request Entity Too Large',
]);

export function friendlyMessage(
  status: number,
  code: ErrorCode | undefined,
): string {
  if (code && CODE_FALLBACK_MESSAGES[code]) {
    return CODE_FALLBACK_MESSAGES[code];
  }
  return STATUS_FALLBACK_MESSAGES[status] ?? 'Something went wrong';
}
