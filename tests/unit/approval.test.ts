import { describe, expect, it } from 'vitest';
import { ApprovalService } from '../../src/services/approval-service.js';

describe('ApprovalService', () => {
  const now = () => 1_000_000_000;
  const ttlMs = 60_000;
  const svc = new ApprovalService({ ttlMs, nowFn: now });

  it('issues a token', () => {
    const token = svc.issueApproval('create', { issueKey: 'ABC-1', date: '2026-10-28' });
    expect(token).toHaveLength(48);
    expect(svc.size()).toBe(1);
  });

  it('validates a matching token', () => {
    const payload = { issueKey: 'ABC-1', date: '2026-10-28' };
    const token = svc.issueApproval('create', payload);
    expect(svc.validateApproval(token, 'create', payload)).toEqual({ ok: true });
  });

  it('rejects unknown token', () => {
    expect(svc.validateApproval('invalid', 'create', {})).toEqual({
      ok: false,
      reason: expect.stringContaining('Unknown'),
    });
  });

  it('rejects expired token', () => {
    let t = 1_000_000_000;
    const svc2 = new ApprovalService({ ttlMs: 60_000, nowFn: () => t });
    const token = svc2.issueApproval('create', { x: 1 });
    expect(svc2.validateApproval(token, 'create', { x: 1 }).ok).toBe(true);
    t += 61_000; // advance past TTL
    const result = svc2.validateApproval(token, 'create', { x: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('expired');
  });

  it('rejects payload mismatch', () => {
    const token = svc.issueApproval('create', { issueKey: 'ABC-1' });
    expect(svc.validateApproval(token, 'create', { issueKey: 'XYZ-1' })).toEqual({
      ok: false,
      reason: expect.stringContaining('does not match'),
    });
  });

  it('rejects kind mismatch', () => {
    const token = svc.issueApproval('create', { x: 1 });
    expect(svc.validateApproval(token, 'update', { x: 1 })).toEqual({
      ok: false,
      reason: expect.stringContaining('create'),
    });
  });

  it('prunes expired approvals', () => {
    let t = 100;
    const svc2 = new ApprovalService({ ttlMs: 1, nowFn: () => t });
    svc2.issueApproval('create', { a: 1 });
    expect(svc2.size()).toBe(1);
    t = 200; // advance past ttl
    svc2.prune();
    expect(svc2.size()).toBe(0);
  });
});
