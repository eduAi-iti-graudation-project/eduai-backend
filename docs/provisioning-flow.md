# Provisioning Flow — students & guardians

The state machine behind school-provisioned accounts. Read this before touching
`join-requests`, `auth` verify endpoints, or the `guardian` module.

## Timeline

```
Admin imports CSV (with or without guardian rows)
   │
   ├─ Student rows exist ─────────────► JoinRequests created (ROSTER, PENDING)
   │                                      approval: admin clicks approve, or
   │                                      auto-approve on import (decidedBy)
   │
   └─ Guardian rows exist ────────────► Provisioned with the student approval:
                                         1. Dedupe by personalEmail per org
                                         2. School-email login identity created
                                            (schoolEmailCandidate → emailDomain
                                            .org, falls back to eduai.org)
                                         3. Password generated + encrypted
                                            (CREDENTIALS_ENCRYPTION_KEY)
                                         4. Verify token issued (72h TTL)
                                         5. GuardianProfile row (SSN encrypted)
                                         6. Student linked via guardianId
```

## States

| State | Meaning | Where it lives |
|---|---|---|
| `invitePending` | A PENDING ROSTER join request exists for this student | derived in `GET /auth/me` |
| `guardianLinked` | Student has `guardianId` set | `GET /auth/me` |
| `emailVerifiedAt == null` | Guardian never clicked the verify link → **unlocks** the guardian dashboard | `User.emailVerifiedAt` |
| `profileComplete == false` | Guardian still owes profile fields (SSN, phone, nationality, street, city) | `GuardianProfile.profileComplete` |

## Guardian gating

1. `GuardianRequirementGuard` (global APP_GUARD, after RolesGuard):
   - STUDENT with `guardianId == null` → 403 `GUARDIAN_REQUIRED` + hint `LINK_GUARDIAN`
     (except `@AllowGuardianless()` routes: self-data reads, dashboard, study-lab, meetings).
2. `GuardianService.assertVerified` (per-endpoint in the guardian module):
   - unverified → 403 `GUARDIAN_VERIFY_REQUIRED` + hint `VERIFY_EMAIL`.
3. `profile()` returns `requiresCompletion` until SSN + phone + nationality +
   street + city are set; `PATCH /guardian/me/profile` completes it.

## Verify / reveal / resend

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /auth/verify-email` | public (token) | Mark verified; one-time reveal of `{ email, password, schoolCode }` |
| `POST /auth/credentials/resend` | public | Re-deliver the reveal (only for users who verified) |
| `POST /students/:id/credentials/reset` | ADMIN | Regenerate a student's login password (returned once) |
| `POST /guardian/me/resend` | GUARDIAN (verified) | Re-send the guardian reveal to `personalEmail` |

Invite links expire after 72h — resendable via the join-requests approve endpoint.

## Split import (guardian-less CSV rows)

- Rows with valid guardian data: student + guardian provisioned together (auto-
  approved when `decidedBy` is passed, i.e. admin-triggered import).
- Rows with missing/invalid guardian data: student imported **without** guardian;
  the row is flagged `needsFollowUp`; the student shows under
  `GET /students?withoutGuardian=true`; the dashboard's `studentsWithoutGuardian`
  count surfaces it. The admin links a guardian later via
  `POST /students/:id/guardian` (`{ guardianId }` or `{ email, name }`).

## IDs

- `stageRoster` (join_requests): `{ staged, queued, notStaged }` —
  `queued` = auto-approval skipped (no `decidedBy` / no auth), still PENDING.
- Error codes: `GUARDIAN_REQUIRED`, `GUARDIAN_VERIFY_REQUIRED`,
  `CREDENTIALS_ENCRYPTION_NOT_CONFIGURED`; hints: `LINK_GUARDIAN`, `VERIFY_EMAIL`.