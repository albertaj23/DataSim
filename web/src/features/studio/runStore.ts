import { create } from 'zustand';
import {
  isTerminal,
  type ProvisionProgressEvent, type RunFinishedEvent, type RunLocksEvent, type RunReport, type RunSample, type RunStatus, type RunStatusEvent,
} from '@datasim/shared';

/** Samples kept for the live charts. At 1 Hz this is 15 minutes: more than any run the UI can start. */
export const RING_CAP = 900;
export const LOG_CAP = 200;

export interface LogEntry { at: number; text: string; tone: 'neutral' | 'ok' | 'bad' }
export interface RunState {
  projectId: string | null;
  runId: string | null;
  /** Strategy comparison: child run ids whose live events are shown under the parent run. */
  children: string[];
  currentChild: string | null;
  status: RunStatus | null;
  phase: string;
  elapsedS: number;
  totalS: number;
  step: { n: number; of: number; vus: number } | null;
  provision: { doneRows: number; allRows: number; table: string } | null;
  samples: RunSample[];
  /** Latest per-node metrics from the live stream (RunSample.nodes). Cleared on finish. */
  liveNodes: Record<string, Record<string, number>>;
  locks: RunLocksEvent['edges'];
  log: LogEntry[];
  report: RunReport | null;
}

export const initialRunState = (): RunState => ({
  projectId: null, runId: null, children: [], currentChild: null, status: null, phase: '', elapsedS: 0, totalS: 0, step: null, provision: null,
  samples: [], liveNodes: {}, locks: [], log: [], report: null,
});

// ---------------------------------------------------------------- pure reducers (state in, state out)
const withLog = (s: RunState, text: string, tone: LogEntry['tone'] = 'neutral', at = Date.now()): LogEntry[] => {
  const last = s.log[s.log.length - 1];
  if (last && last.text === text) return s.log;
  return [...s.log, { at, text, tone }].slice(-LOG_CAP);
};

export const accepts = (s: Pick<RunState, 'runId' | 'children'>, id: string) => id === s.runId || s.children.includes(id);

export function begin(projectId: string, runId: string, children: string[] = [], at = Date.now()): RunState {
  const s = { ...initialRunState(), projectId, runId, children, status: 'QUEUED' as RunStatus, phase: 'Queued' };
  return { ...s, log: [{ at, text: children.length ? `Comparing ${children.length} strategies` : 'Run queued', tone: 'neutral' }] };
}

export function applyStatus(s: RunState, e: RunStatusEvent, at = Date.now()): RunState {
  if (!accepts(s, e.runId)) return s;
  // A new child run starts its own clock: restart the live charts.
  const newChild = e.runId !== s.runId && e.runId !== s.currentChild;
  const label = e.phase + (e.step ? ` (step ${e.step.n}/${e.step.of}, ${e.step.vus} VUs)` : '');
  return {
    ...s, currentChild: e.runId !== s.runId ? e.runId : s.currentChild, samples: newChild ? [] : s.samples, status: e.status, phase: e.phase, elapsedS: e.elapsedS ?? 0, totalS: e.totalS ?? 0, step: e.step ?? s.step,
    provision: e.status === 'PROVISIONING' ? s.provision : null,
    log: withLog(s, e.message ? `${label}: ${e.message}` : label, e.status === 'FAILED' ? 'bad' : 'neutral', at),
  };
}

export function applyProgress(s: RunState, e: ProvisionProgressEvent): RunState {
  if (!accepts(s, e.runId)) return s;
  return { ...s, provision: { doneRows: e.doneRows, allRows: e.allRows, table: e.table } };
}

/** Append samples to the ring buffer (oldest dropped past RING_CAP) and remember the newest per-node metrics. */
export function appendSamples(s: RunState, batch: RunSample[]): RunState {
  if (batch.length === 0) return s;
  const samples = s.samples.length + batch.length > RING_CAP ? [...s.samples, ...batch].slice(-RING_CAP) : [...s.samples, ...batch];
  const nodes = [...batch].reverse().find((x) => x.nodes)?.nodes;
  return { ...s, samples, liveNodes: nodes ?? s.liveNodes };
}

export function applyLocks(s: RunState, e: RunLocksEvent): RunState {
  return accepts(s, e.runId) ? { ...s, locks: e.edges } : s;
}

export function applyFinished(s: RunState, e: RunFinishedEvent, at = Date.now()): RunState {
  if (e.runId !== s.runId) return s;
  const verdict = e.sloPass === null ? '' : e.sloPass ? ' · SLO pass' : ' · SLO fail';
  return { ...s, status: e.status, liveNodes: {}, locks: [], provision: null, log: withLog(s, `Run ${e.status.toLowerCase()}${verdict}`, e.status === 'COMPLETED' ? (e.sloPass === false ? 'bad' : 'ok') : 'bad', at) };
}

/** Attach the persisted report (after a run, or when opening a past run). Static samples replace the live buffer. */
export function applyReport(s: RunState, report: RunReport, projectId: string | null = s.projectId): RunState {
  const fresh = s.runId !== report.run.runId;
  const base: RunState = fresh ? { ...initialRunState(), projectId, runId: report.run.runId, log: [] } : s;
  const run = report.run;
  const log = base.log.length
    ? base.log
    : [
        ...(run.startedAt ? [{ at: Date.parse(run.startedAt), text: `Run started · ${run.kind.toLowerCase()} · ${run.strategy} · ${run.vus} VUs`, tone: 'neutral' as const }] : []),
        ...(run.finishedAt ? [{ at: Date.parse(run.finishedAt), text: `Run ${run.status.toLowerCase()}${run.errorText ? `: ${run.errorText}` : ''}`, tone: run.status === 'COMPLETED' ? 'ok' as const : 'bad' as const }] : []),
      ];
  return {
    ...base, status: run.status, phase: run.status === 'COMPLETED' ? 'Completed' : run.status === 'FAILED' ? 'Failed' : base.phase,
    samples: report.samples.length ? report.samples : base.samples, liveNodes: {}, locks: [], provision: null, log, report,
  };
}

// ---------------------------------------------------------------- derived
export const isActive = (s: Pick<RunState, 'runId' | 'status'>) => !!s.runId && !!s.status && !isTerminal(s.status);

export const PHASES = ['Provisioning', 'Warm-up', 'Measuring', 'Analyzing'] as const;
export function phaseIndex(status: RunStatus | null): number {
  switch (status) {
    case 'QUEUED': case 'PROVISIONING': return 0;
    case 'WARMING': return 1;
    case 'RUNNING': return 2;
    case 'ANALYZING': return 3;
    case 'COMPLETED': case 'FAILED': case 'CANCELLED': return 4;
    default: return -1;
  }
}

const rows = (n: number) => Math.round(n).toLocaleString('en-US');
/** One-line phase description: "Provisioning sandbox · 42,000 / 100,000 rows", "Measuring 12/20 s". */
export function describePhase(s: Pick<RunState, 'status' | 'phase' | 'elapsedS' | 'totalS' | 'provision' | 'step'>): string {
  const step = s.step ? `Step ${s.step.n}/${s.step.of} · ${s.step.vus} VUs · ` : '';
  switch (s.status) {
    case 'QUEUED': return 'Queued';
    case 'PROVISIONING': return s.provision && s.provision.allRows > 0 ? `Provisioning sandbox · ${rows(s.provision.doneRows)} / ${rows(s.provision.allRows)} rows` : 'Provisioning sandbox';
    case 'WARMING': return `${step}Warm-up ${Math.floor(s.elapsedS)}/${Math.round(s.totalS)} s`;
    case 'RUNNING': return `${step}Measuring ${Math.floor(s.elapsedS)}/${Math.round(s.totalS)} s`;
    case 'ANALYZING': return 'Analyzing';
    case 'COMPLETED': return 'Completed';
    case 'FAILED': return 'Failed';
    case 'CANCELLED': return 'Cancelled';
    default: return s.phase;
  }
}

/** Progress inside the phase bar: finished phases are 1, the current one is its fraction, later ones 0. */
export function phaseFill(s: Pick<RunState, 'status' | 'elapsedS' | 'totalS' | 'provision'>, index: number): number {
  const cur = phaseIndex(s.status);
  if (index < cur) return 1;
  if (index > cur) return 0;
  if (index === 0) return s.provision && s.provision.allRows > 0 ? Math.min(1, s.provision.doneRows / s.provision.allRows) : 0.05;
  if (index === 1 || index === 2) return s.totalS > 0 ? Math.min(1, s.elapsedS / s.totalS) : 0;
  return 0.5;
}

// ---------------------------------------------------------------- store + throttled sample intake
interface RunActions {
  begin: (projectId: string, runId: string, children?: string[]) => void;
  onStatus: (e: RunStatusEvent) => void;
  onProgress: (e: ProvisionProgressEvent) => void;
  pushSamples: (batch: RunSample[]) => void;
  onLocks: (e: RunLocksEvent) => void;
  onFinished: (e: RunFinishedEvent) => void;
  setReport: (r: RunReport, projectId?: string | null) => void;
  /** Drop everything when the Studio opens a different project. */
  reset: () => void;
}

export const useRunStore = create<RunState & RunActions>()((set) => ({
  ...initialRunState(),
  begin: (projectId, runId, children) => set(() => begin(projectId, runId, children)),
  onStatus: (e) => set((s) => applyStatus(s, e)),
  onProgress: (e) => set((s) => applyProgress(s, e)),
  pushSamples: (batch) => set((s) => appendSamples(s, batch)),
  onLocks: (e) => set((s) => applyLocks(s, e)),
  onFinished: (e) => set((s) => applyFinished(s, e)),
  setReport: (r, projectId) => set((s) => applyReport(s, r, projectId)),
  reset: () => set(() => initialRunState()),
}));

/**
 * Collects samples and hands them over at most once per `ms` (default 500 ms = 2 Hz), so a burst of socket events
 * costs one React update. `flush()` pushes immediately (call before reading the final state).
 */
export function createSampleBuffer(push: (batch: RunSample[]) => void, ms = 500) {
  let pending: RunSample[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (pending.length) { const b = pending; pending = []; push(b); }
  };
  return {
    add(sample: RunSample) { pending.push(sample); if (!timer) timer = setTimeout(flush, ms); },
    flush,
    cancel() { if (timer) clearTimeout(timer); timer = null; pending = []; },
  };
}
