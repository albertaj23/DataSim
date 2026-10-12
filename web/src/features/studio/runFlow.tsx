import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  isTerminal, validateDesign,
  type CompareStrategiesResponse, type ProjectDetail, type RunReport, type RunSummary, type StartRunResponse,
} from '@datasim/shared';
import { api, errorMessage } from '../../lib/api';
import { useDesignStore } from '../../lib/designStore';
import { useRunEvents } from '../../lib/socket';
import { useToast } from '../../ui';
import { flushSave } from './persist';
import { createSampleBuffer, isActive, useRunStore } from './runStore';
import { useStudioUi } from './studioUi';

export type RunKindChoice = 'LOAD' | 'CAPACITY';

const rs = () => useRunStore.getState();

/** Streams one run room into the run store. Rendered once per active run (and once per child during a strategy comparison). */
function RunEventBridge({ runId, onFinished }: { runId: string; onFinished: (runId: string) => void }) {
  const buffer = useMemo(() => createSampleBuffer((b) => rs().pushSamples(b)), []);
  useEffect(() => () => buffer.cancel(), [buffer]);
  useRunEvents(runId, {
    onStatus: (e) => rs().onStatus(e),
    onProgress: (e) => rs().onProgress(e),
    onSample: (e) => buffer.add(e.sample),
    onLocks: (e) => rs().onLocks(e),
    onFinished: (e) => { buffer.flush(); rs().onFinished(e); onFinished(e.runId); },
  });
  return null;
}

/** Mount once in the Studio: owns socket subscriptions, finish handling, the `?run=` deep link and the polling safety net. */
export function RunController({ projectId }: { projectId: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const runId = useRunStore((s) => s.runId);
  const children = useRunStore((s) => s.children);
  const active = useRunStore(isActive);
  const finalizing = useRef<string | null>(null);

  const fetchReport = useCallback(async (id: string): Promise<RunReport | null> => {
    const res = await api.get<RunReport>(`/runs/${id}`);
    if (!res.ok) return null;
    rs().setReport(res.body, projectId);
    return res.body;
  }, [projectId]);

  const finalize = useCallback(async (id: string) => {
    if (rs().runId !== id || finalizing.current === id) return;
    finalizing.current = id;
    const compare = rs().children.length > 0;
    const report = await fetchReport(id);
    if (!report) { finalizing.current = null; return; }
    const run = report.run;
    if (compare) {
      toast.success('Strategy comparison finished', 'Opening the comparison.');
      const ids = rs().children;
      navigate(`/compare?ids=${ids.join(',')}`);
      return;
    }
    if (run.status === 'FAILED') toast.error('Run failed', run.errorText ?? 'The run stopped with an error.');
    else if (run.status === 'CANCELLED') toast.info('Run cancelled');
    else if (report.slo) toast(report.slo.pass ? 'SLO pass' : 'SLO fail', { tone: report.slo.pass ? 'success' : 'error', description: report.slo.pass ? `p95 ${Math.round(run.p95Ms)} ms, ${run.invariantViolations} invariant violation(s).` : report.slo.reasons.join(' · ') });
    else toast.success('Run finished');
  }, [fetchReport, navigate, toast]);

  // Deep link `?run=<id>` and "last run of this project" on open. Skipped when the store already follows this project's run.
  useEffect(() => {
    const st = rs();
    if (st.projectId === projectId && st.runId) return;
    st.reset();
    const wanted = params.get('run');
    let cancelled = false;
    void (async () => {
      if (wanted) {
        const report = await fetchReport(wanted);
        if (cancelled) return;
        if (report && !isTerminal(report.run.status)) rs().begin(projectId, wanted);
        if (report) useStudioUi.getState().openPanel('live');
        else toast.error('Run not found', 'The run in the link does not exist.');
        return;
      }
      const list = await api.get<RunSummary[]>(`/runs?projectId=${projectId}`);
      if (cancelled || !list.ok || !Array.isArray(list.body)) return;
      const last = list.body.find((r) => r.kind !== 'STRATEGY_CHILD' && r.status === 'COMPLETED' && !r.errorText && r.durationS > 0);
      if (last) await fetchReport(last.runId);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Keep `?run=` in the URL while a run is shown so the report page can link back and a reload restores it.
  useEffect(() => {
    if (runId && params.get('run') !== runId && active) setParams((p) => { p.set('run', runId); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, active]);

  // Safety net: if the socket drops or `run:finished` was missed, poll the run until it is terminal.
  useEffect(() => {
    if (!active || !runId) return;
    const t = setInterval(async () => {
      const res = await api.get<RunReport>(`/runs/${runId}`);
      if (res.ok && isTerminal(res.body.run.status)) { rs().onFinished({ runId, status: res.body.run.status, sloPass: res.body.run.sloPass }); void finalize(runId); }
    }, 4000);
    return () => clearInterval(t);
  }, [active, runId, finalize]);

  if (!runId || !active) return null;
  return (
    <>
      {[runId, ...children].map((id) => <RunEventBridge key={id} runId={id} onFinished={(fid) => { if (fid === runId) void finalize(fid); }} />)}
    </>
  );
}

/** Imperative run actions for the top bar and shortcuts. */
export function useRunActions(projectId: string) {
  const toast = useToast();
  const starting = useRef(false);

  const prepare = useCallback(async (): Promise<boolean> => {
    if (starting.current) return false;
    const problems = validateDesign(useDesignStore.getState().design).filter((p) => p.severity === 'error');
    if (problems.length > 0) {
      toast.error(`Fix ${problems.length} problem${problems.length === 1 ? '' : 's'} before running`, problems[0]!.message);
      return false;
    }
    if (isActive(rs())) { toast.error('A run is already in progress', 'Cancel it or wait for it to finish.'); return false; }
    if (!(await flushSave())) { toast.error('Could not save the draft', 'Fix the connection and try again.'); return false; }
    return true;
  }, [toast]);

  /** The server pins the draft when a run starts; mirror that revision number locally. */
  const syncRevision = useCallback(async (pinned: unknown) => {
    const p = await api.get<ProjectDetail>(`/projects/${projectId}`);
    if (!p.ok || p.body.pinnedRevisionNo == null) return;
    const st = useDesignStore.getState();
    // Edited since the run pinned it: show the new number but keep "draft" state.
    if (st.design !== pinned) useDesignStore.setState({ revisionNo: p.body.pinnedRevisionNo });
    else st.setRevisionNo(p.body.pinnedRevisionNo);
  }, [projectId]);

  const start = useCallback(async (kind: RunKindChoice) => {
    if (!(await prepare())) return;
    starting.current = true;
    const pinned = useDesignStore.getState().design;
    try {
      const res = await api.post<StartRunResponse>(`/projects/${projectId}/runs`, { kind, overrides: {} });
      if (!res.ok) { toast.error(res.body && (res.body as { code?: string }).code === 'RUN_ACTIVE' ? 'A run is already active' : 'Could not start the run', errorMessage(res)); return; }
      rs().begin(projectId, res.body.runId);
      useStudioUi.getState().openPanel('live');
      void syncRevision(pinned);
    } finally { starting.current = false; }
  }, [prepare, projectId, syncRevision, toast]);

  const compareStrategies = useCallback(async () => {
    if (!(await prepare())) return;
    starting.current = true;
    const pinned = useDesignStore.getState().design;
    try {
      const res = await api.post<CompareStrategiesResponse>(`/projects/${projectId}/compare-strategies`, {});
      if (!res.ok) { toast.error('Could not compare strategies', errorMessage(res)); return; }
      rs().begin(projectId, res.body.parentRunId, res.body.runIds);
      useStudioUi.getState().openPanel('live');
      void syncRevision(pinned);
    } finally { starting.current = false; }
  }, [prepare, projectId, syncRevision, toast]);

  const cancel = useCallback(async () => {
    const id = rs().runId;
    if (!id) return;
    const res = await api.post(`/runs/${id}/cancel`);
    if (!res.ok) toast.error('Could not cancel', errorMessage(res));
  }, [toast]);

  return { start, compareStrategies, cancel };
}
