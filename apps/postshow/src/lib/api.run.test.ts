import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runJobNow } from './api';
import { invokePostshowFunction } from './functionClient';

vi.mock('./functionClient', () => ({ invokePostshowFunction: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: {} }));

const invoke = vi.mocked(invokePostshowFunction);
const jobId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';

describe('manual run client contract', () => {
  beforeEach(() => invoke.mockReset());

  it('sends the stable request UUID and accepts an idempotent in-flight replay', async () => {
    invoke.mockResolvedValue({ ok: true, run_id: runId, status: 'running' });

    await expect(runJobNow(jobId, requestId)).resolves.toEqual({
      ok: true,
      run_id: runId,
      status: 'running',
    });
    expect(invoke).toHaveBeenCalledWith('postshow-run', {
      job_id: jobId,
      request_id: requestId,
    });
  });

  it('accepts only the exact completed-run success envelope', async () => {
    invoke.mockResolvedValue({ ok: true, run_id: runId, stats: { sessions: 4 } });
    await expect(runJobNow(jobId, requestId)).resolves.toEqual({
      ok: true,
      run_id: runId,
      stats: { sessions: 4 },
    });

    for (const response of [
      null,
      {},
      { ok: 'true', run_id: runId, status: 'running' },
      { ok: true, run_id: 'not-a-uuid', status: 'running' },
      { ok: true, run_id: runId },
      { ok: true, run_id: runId, status: 'done' },
      { ok: true, run_id: runId, status: 'running', detail: 'expanded' },
      { ok: true, run_id: runId, stats: [] },
    ]) {
      invoke.mockResolvedValueOnce(response);
      await expect(runJobNow(jobId, requestId)).rejects.toThrow(/invalid response/i);
    }
  });

  it('rejects malformed request identifiers before network dispatch', async () => {
    await expect(runJobNow('not-a-job', requestId)).rejects.toThrow(/identifiers are invalid/i);
    await expect(runJobNow(jobId, 'not-a-request')).rejects.toThrow(/identifiers are invalid/i);
    expect(invoke).not.toHaveBeenCalled();
  });
});
