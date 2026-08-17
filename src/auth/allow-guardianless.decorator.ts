import { SetMetadata } from '@nestjs/common';

export const ALLOW_GUARDIANLESS_KEY = 'allowGuardianless';

/**
 * Opt a route OUT of the guardian requirement (WP2 enforcement). Student
 * read-only endpoints (grades, classes, dashboard overview, etc.) stay
 * usable while the student has no linked guardian; everything else is
 * blocked with GUARDIAN_REQUIRED until one is linked.
 */
export const AllowGuardianless = () =>
  SetMetadata(ALLOW_GUARDIANLESS_KEY, true);
