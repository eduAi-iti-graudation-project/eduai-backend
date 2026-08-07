import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

export const SUBMITTED = 'SUBMITTED';
export const GRADING_IN_PROGRESS = 'GRADING_IN_PROGRESS';
export const REVIEW_READY = 'REVIEW_READY';
export const CONFIRMED = 'CONFIRMED';

const VALID_TRANSITIONS: Record<string, string[]> = {
  [SUBMITTED]: [GRADING_IN_PROGRESS],
  [GRADING_IN_PROGRESS]: [REVIEW_READY],
  [REVIEW_READY]: [CONFIRMED],
  [CONFIRMED]: [],
};

export function transitionStatus(current: string, next: string): void {
  if (current === next) return;

  const allowed = VALID_TRANSITIONS[current];
  if (!allowed?.includes(next)) {
    throw new ApiError(
      ErrorCode.INVALID_STATUS_TRANSITION,
      HttpStatus.CONFLICT,
      'This submission cannot move to that state.',
    );
  }
}
