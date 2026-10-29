import { createHash, randomBytes } from 'node:crypto';
import { DEFAULTS } from '../config/constants.js';
import { ApprovalRequiredError } from '../utils/errors.js';

/**
 * Short-lived in-memory approval store.
 *
 * Design (see docs/security.md):
 * - `tempo_preview_worklog` issues an approval token bound to the EXACT payload.
 * - Write tools require the token; the payload hash must match byte-for-byte.
 * - Any change to the proposed payload invalidates the previous approval
 *   (hash mismatch), forcing a fresh preview.
 * - Tokens expire after approvalTtlMs.
 *
 * Known limitations (documented, not hidden):
 * - In-memory only: approvals do not survive a server restart.
 * - Scoped to one server process; concurrent clients of the same process share
 *   the store (same trust domain as the stdio transport itself).
 */
export type ApprovalKind = 'create' | 'update';

export interface ApprovalRecord {
  kind: ApprovalKind;
  payloadHash: string;
  expiresAt: number;
}

export interface ApprovalCheckResult {
  ok: boolean;
  reason?: string;
}

export class ApprovalService {
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly ttlMs: number;
  private readonly nowFn: () => number;

  constructor(opts: { ttlMs?: number; nowFn?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULTS.approvalTtlMs;
    this.nowFn = opts.nowFn ?? (() => Date.now());
  }

  /** Issues a new approval token bound to the exact payload. */
  issueApproval(kind: ApprovalKind, payload: unknown): string {
    this.prune();
    const token = randomBytes(24).toString('hex');
    this.approvals.set(token, {
      kind,
      payloadHash: hashPayload(payload),
      expiresAt: this.nowFn() + this.ttlMs,
    });
    return token;
  }

  /**
   * Validates that the token exists, matches kind and EXACT payload, and has not expired.
   * The token is NOT consumed: a verification failure after a successful write
   * must not force the user to re-approve.
   */
  validateApproval(token: string, kind: ApprovalKind, payload: unknown): ApprovalCheckResult {
    const record = this.approvals.get(token);
    if (!record) {
      return {
        ok: false,
        reason: 'Unknown approval token. Run the preview step again and use the new token.',
      };
    }
    if (record.expiresAt <= this.nowFn()) {
      this.approvals.delete(token);
      return { ok: false, reason: 'Approval token has expired. Run the preview step again.' };
    }
    if (record.kind !== kind) {
      return {
        ok: false,
        reason: `Approval token was issued for a "${record.kind}" operation, not "${kind}".`,
      };
    }
    const hash = hashPayload(payload);
    if (hash !== record.payloadHash) {
      return {
        ok: false,
        reason:
          'The payload does not match the approved preview. Any change requires a new preview and a new approval.',
      };
    }
    return { ok: true };
  }

  /** Removes expired tokens. */
  prune(): void {
    const now = this.nowFn();
    for (const [token, record] of this.approvals) {
      if (record.expiresAt <= now) this.approvals.delete(token);
    }
  }

  /** Test/admin helper: number of live approvals. */
  size(): number {
    this.prune();
    return this.approvals.size;
  }
}

/** Enforces an approval result as an exception. */
export function requireApproval(result: ApprovalCheckResult): void {
  if (!result.ok) {
    throw new ApprovalRequiredError(result.reason ?? 'Approval required.');
  }
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

/** Deterministic JSON.stringify for hash stability. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortValue(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}
