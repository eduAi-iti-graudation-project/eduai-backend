import { BadRequestException } from '@nestjs/common';

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
    throw new BadRequestException(
      `Invalid submission status transition from ${current} to ${next}`,
    );
  }
}
