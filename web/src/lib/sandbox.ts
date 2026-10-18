// Client for the sandbox endpoints used by the Schema Designer and Workload Editor.
// The server reads the *saved draft*, so every call that depends on the design flushes the editor document first.
import { useCallback, useState } from 'react';
import type { ProvisionProgressEvent, ProvisionResponse, QueryResponse, TestTxnBody, TestTxnResponse } from '@datasim/shared';
import { api, errorMessage } from './api';
import { useDesignStore } from './designStore';
import { useRunEvents } from './socket';
import { useToast } from './toast';

export interface SandboxFailure { code: string; message: string; /** Offending table when the server could tell (DDL / seed errors). */ table: string | null }
export type SandboxResult<T> = { ok: true; value: T } | { ok: false; error: SandboxFailure };

const fail = (res: { status: number; body: unknown }, message: string): SandboxResult<never> => {
  const b = (res.body ?? {}) as { code?: string; table?: string | null };
  return { ok: false, error: { code: b.code ?? (res.status === 0 ? 'NETWORK' : 'ERROR'), message, table: b.table ?? null } };
};

/** PUT the current editor document as the project draft. */
export async function flushDraft(): Promise<SandboxResult<null>> {
  const { projectId, design } = useDesignStore.getState();
  if (!projectId) return { ok: false, error: { code: 'NO_PROJECT', message: 'No project is open', table: null } };
  const res = await api.put(`/projects/${projectId}/draft`, design);
  return res.ok ? { ok: true, value: null } : fail(res, errorMessage(res));
}

async function call<T>(path: string, body: unknown, flush: boolean): Promise<SandboxResult<T>> {
  const { projectId } = useDesignStore.getState();
  if (!projectId) return { ok: false, error: { code: 'NO_PROJECT', message: 'No project is open', table: null } };
  if (flush) {
    const f = await flushDraft();
    if (!f.ok) return f;
  }
  const res = await api.post<T>(`/projects/${projectId}/sandbox/${path}`, body);
  return res.ok ? { ok: true, value: res.body } : fail(res, errorMessage(res));
}

export const provisionSandbox = (rowScale?: number) => call<ProvisionResponse>('provision', rowScale && rowScale !== 1 ? { rowScale } : {}, true);
export const testTransaction = (body: TestTxnBody) => call<TestTxnResponse>('test-txn', body, true);
export const sandboxQuery = (sql: string) => call<QueryResponse>('query', { sql }, false);

export const isNotProvisioned = (e: SandboxFailure) => e.code === 'NOT_PROVISIONED';

/** Provision with live row progress (socket) and toasts. One instance per panel. */
export function useProvision() {
  const toast = useToast();
  const projectId = useDesignStore((s) => s.projectId);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProvisionProgressEvent | null>(null);
  const [result, setResult] = useState<ProvisionResponse | null>(null);
  const [error, setError] = useState<SandboxFailure | null>(null);

  useRunEvents(projectId, { onProgress: (e) => setProgress(e) });

  const run = useCallback(async (rowScale?: number) => {
    setBusy(true); setProgress(null); setError(null); setResult(null);
    const r = await provisionSandbox(rowScale);
    setBusy(false); setProgress(null);
    if (r.ok) {
      setResult(r.value);
      toast.success('Sandbox provisioned', `${r.value.tables} tables, ${r.value.rows.toLocaleString('en-US')} rows in ${(r.value.ms / 1000).toFixed(1)} s`);
    } else {
      setError(r.error);
      toast.error('Provisioning failed', r.error.message);
    }
    return r;
  }, [toast]);

  return { run, busy, progress, result, error, clear: () => { setResult(null); setError(null); } };
}
