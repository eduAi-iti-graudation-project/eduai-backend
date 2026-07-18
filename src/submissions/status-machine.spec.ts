import { transitionStatus } from './status-machine';

describe('transitionStatus', () => {
  it('allows SUBMITTED → GRADING_IN_PROGRESS', () => {
    expect(() =>
      transitionStatus('SUBMITTED', 'GRADING_IN_PROGRESS'),
    ).not.toThrow();
  });

  it('allows GRADING_IN_PROGRESS → REVIEW_READY', () => {
    expect(() =>
      transitionStatus('GRADING_IN_PROGRESS', 'REVIEW_READY'),
    ).not.toThrow();
  });

  it('allows REVIEW_READY → CONFIRMED', () => {
    expect(() => transitionStatus('REVIEW_READY', 'CONFIRMED')).not.toThrow();
  });

  it('allows same status (no-op)', () => {
    expect(() => transitionStatus('SUBMITTED', 'SUBMITTED')).not.toThrow();
  });

  it('rejects SUBMITTED → REVIEW_READY (skip)', () => {
    expect(() => transitionStatus('SUBMITTED', 'REVIEW_READY')).toThrow(
      'Invalid submission status transition',
    );
  });

  it('rejects SUBMITTED → CONFIRMED (skip)', () => {
    expect(() => transitionStatus('SUBMITTED', 'CONFIRMED')).toThrow(
      'Invalid submission status transition',
    );
  });

  it('rejects CONFIRMED → REVIEW_READY (reverse)', () => {
    expect(() => transitionStatus('CONFIRMED', 'REVIEW_READY')).toThrow(
      'Invalid submission status transition',
    );
  });

  it('rejects CONFIRMED → SUBMITTED (reverse)', () => {
    expect(() => transitionStatus('CONFIRMED', 'SUBMITTED')).toThrow(
      'Invalid submission status transition',
    );
  });

  it('rejects GRADING_IN_PROGRESS → SUBMITTED (reverse)', () => {
    expect(() => transitionStatus('GRADING_IN_PROGRESS', 'SUBMITTED')).toThrow(
      'Invalid submission status transition',
    );
  });
});
