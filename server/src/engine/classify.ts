// MySQL error classification for the workload runner (brief 4.4).
import { errnoOf } from '../db/errors.js';

export const ER_CHECK_VIOLATED = 3819;
export const ER_QUERY_TIMEOUT = 3024;
export const ER_ROW_IS_REFERENCED_2 = 1451;

export type ErrClass = 'deadlock' | 'lock_timeout' | 'duplicate' | 'check' | 'fk' | 'timeout' | 'other';
/** retry: re-run per the App retry policy; reject: business rejection (REJECTED, not ERROR); error: count as ERROR. */
export type ErrAction = 'retry' | 'reject' | 'error';

export function classifyError(err: unknown): ErrClass {
  switch (errnoOf(err)) {
    case 1213: return 'deadlock';
    case 1205: return 'lock_timeout';
    case 1062: return 'duplicate';
    case ER_CHECK_VIOLATED: return 'check';
    case 1452: case ER_ROW_IS_REFERENCED_2: return 'fk';
    case ER_QUERY_TIMEOUT: return 'timeout';
    default: return 'other';
  }
}

export function actionFor(cls: ErrClass): ErrAction {
  switch (cls) {
    case 'deadlock': case 'lock_timeout': return 'retry';
    case 'duplicate': case 'check': return 'reject';
    default: return 'error';
  }
}

/** True when the connection itself is unusable and must be destroyed instead of released. */
export const isFatal = (err: unknown): boolean => (err as { fatal?: boolean } | null)?.fatal === true || (errnoOf(err) === undefined && typeof (err as { code?: unknown })?.code === 'string' && /^(PROTOCOL_|ECONN|EPIPE|ETIMEDOUT)/.test((err as { code: string }).code));
