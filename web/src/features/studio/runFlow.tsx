import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  isTerminal, validateDesign,
  type CompareStrategiesResponse, type HealthResponse, type ProjectDetail, type RunReport, type RunSummary, type StartRunResponse,
} from '@datasim/shared';
import { api, errorMessage } from '../../lib/api';
import { useDesignStore } from '../../lib/designStore';
import { useRunEvents } from '../../lib/socket';
import { useHealth } from '../../lib/useHealth';
import { useToast } from '../../ui';
import { isCompareReport } from './compare';
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
    // The SLO verdict lives in the Live tab banner; toasts are for failures only. A comparison ends on its result strip.
    if (run.status === 'FAILED') toast.error(compare ? 'Strategy comparison failed' : 'Run failed', run.errorText ?? 'The run stopped with an error.');
    else if (run.status === 'CANCELLED') toast.info(compare ? 'Strategy comparison cancelled' : 'Run cancelled');
    else if (compare) toast.success('Strategy comparison finished');
  }, [fetchReport, toast]);

  /** Follow a run that is already under way (reload, second tab): join its room and show the live view. */
  const attach = useCallback(async (report: RunReport) => {
    const id = report.run.runId;
    let children: string[] = [];
    if (isCompareReport(report)) {
      const list = await api.get<RunSummary[]>(`/runs?projectId=${projectId}&kind=STRATEGY_CHILD`);
      if (list.ok && Array.isArray(list.body)) children = list.body.filter((r) => r.parentRunId === id).sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '')).map((r) => r.runId);
    }
    rs().begin(projectId, id, children);
    useRunStore.setState({ status: report.run.status, samples: report.samples });
    useStudioUi.getState().openPanel('live');
  }, [projectId]);

  // Deep link `?run=<id>`, the project's active run, or its last run, on open. Skipped when the store already follows this project's run.
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
        if (report && !isTerminal(report.run.status)) await attach(report);
        if (report) useStudioUi.getState().openPanel('live');
        else toast.error('Run not found', 'The run in the link does not exist.');
        return;
      }
      // A run of this project may be running right now (opened or reloaded mid-run): attach to it.
      const health = await api.get<HealthResponse>('/health');
      const activeId = health.ok ? health.body.activeRunId : null;
      if (cancelled) return;
      if (activeId) {
        const res = await api.get<RunReport>(`/runs/${activeId}`);
        if (cancelled) return;
        if (res.ok && res.body.run.projectId === projectId && !isTerminal(res.body.run.status)) { await attach(res.body); return; }
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

/** True while another project's run holds the global run lock (this Studio cannot start one). */
export function useForeignRun(projectId: string): boolean {
  const { health } = useHealth();
  const mine = useRunStore((s) => s.runId);
  const children = useRunStore((s) => s.children);
  const activeId = health?.activeRunId ?? null;
  const [owner, setOwner] = useState<{ id: string; projectId: string } | null>(null);
  const known = !!activeId && (activeId === mine || children.includes(activeId));
  useEffect(() => {
    if (!activeId || known || owner?.id === activeId) return;
    let live = true;
    void api.get<RunReport>(`/runs/${activeId}`).then((r) => { if (live && r.ok) setOwner({ id: activeId, projectId: r.body.run.projectId }); });
    return () => { live = false; };
  }, [activeId, known, owner?.id]);
  return !!activeId && !known && owner?.id === activeId && owner.projectId !== projectId;
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
