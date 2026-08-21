import { describe, it, expect } from 'vitest';
import { describeRequestFailure } from '../core/utils/requestError';

describe('describeRequestFailure', () => {
  it('names the request, the status, and the server message', () => {
    const apiError = Object.assign(new Error('Insufficient scope for this operation'), { status: 403 });
    const error = describeRequestFailure('GET /api/sites/site-1/branches', apiError);
    expect(error.message).toBe(
      'GET /api/sites/site-1/branches failed (403): Insufficient scope for this operation',
    );
  });

  it('omits the status when the failure carries none', () => {
    const error = describeRequestFailure('GET /api/sites/site-1/branches', new Error('Network down'));
    expect(error.message).toBe('GET /api/sites/site-1/branches failed: Network down');
  });

  it('handles a non-Error rejection', () => {
    const error = describeRequestFailure('GET /x', 'boom');
    expect(error.message).toBe('GET /x failed: boom');
  });
});
