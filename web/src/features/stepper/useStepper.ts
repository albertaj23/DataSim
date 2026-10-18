import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { getSocket, useStepperRoom } from '../../lib/socket';
import type {
  InvariantResult, LockSnapshot, StepResultView, StepperScenario, StepperStateView, StepperUpdate, TxnLabel, WaitRow,
} from '../../lib/labApi';
import { applyStepResponse, mergeUpdate } from './logic';

const POLL_MS = 500;
const STATE_POLL_MS = 1000;

/** True while the Socket.IO connection is up. */
export function useSocketConnected(): boolean {
  const [up, setUp] = useState(() => getSocket().connected);
  useEffect(() => {
    const s = getSocket();
    const on = () => setUp(true);
    const off = () => setUp(false);
    s.on('connect', on);
    s.on('disconnect', off);
    setUp(s.connected);
    return () => { s.off('connect', on); s.off('disconnect', off); };
  }, []);
  return up;
}

/**
 * All Stepper data flow in one place.
 * - Step outcomes arrive over the `stepper_update` socket push (a blocked step settles long after its HTTP response).
 * - The lock table and wait-for edges are not pushed: they are polled every 500 ms while a scenario is loaded.
 * - Fallback: if the socket is down, or a step is still waiting, the full state is polled every second.
 */
export function useStepper(initialScenario: string | null) {
  const connected = useSocketConnected();
  const [scenarios, setScenarios] = useState<StepperScenario[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [state, setState] = useState<StepperStateView | null>(null);
  const [locks, setLocks] = useState<LockSnapshot | null>(null);
  const [lastWaits, setLastWaits] = useState<WaitRow[]>([]);
  const [invariant, setInvariant] = useState<InvariantResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  useStepperRoom<StepperUpdate>((u) => setState((s) => (s ? mergeUpdate(s, u) : s)));

  // Initial data: scenario list, and whatever the server already has loaded.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [sc, st] = await Promise.all([
        api.get<StepperScenario[]>('/lab/stepper/scenarios'),
        api.get<StepperStateView>('/lab/stepper/state'),
      ]);
      if (!alive) return;
      if (!sc.ok || !Array.isArray(sc.body)) { setOffline(true); setError(errorMessage(sc)); return; }
      setOffline(false); setError(null);
      setScenarios(sc.body);
      const loaded = st.ok ? st.body.scenarioId : null;
      if (loaded) setState(st.body);
      const wanted = initialScenario && sc.body.some((x) => x.id === initialScenario) ? initialScenario : null;
      setSelectedId(wanted ?? loaded ?? sc.body[0]?.id ?? '');
    })();
    return () => { alive = false; };
  }, [initialScenario, attempt]);

  const scenarioId = state?.scenarioId ?? null;
  const anyBusy = !!state && (state.txns.T1.busy || state.txns.T2.busy);

  // Lock table + invariant polling.
  const inflight = useRef(false);
  useEffect(() => {
    if (!scenarioId) { setLocks(null); setInvariant(null); return; }
    let stopped = false;
    const tick = async () => {
      if (stopped || inflight.current || document.hidden) return;
      inflight.current = true;
      const [l, i] = await Promise.all([api.get<LockSnapshot>('/lab/locks'), api.get<InvariantResult>('/lab/stepper/invariant')]);
      inflight.current = false;
      if (stopped) return;
      if (l.ok && Array.isArray(l.body.locks)) {
        setLocks(l.body);
        if (l.body.waits.length > 0) setLastWaits(l.body.waits);
      }
      if (i.ok) setInvariant(i.body);
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [scenarioId]);

  // State polling fallback.
  useEffect(() => {
    if (!scenarioId || (connected && !anyBusy)) return;
    const id = setInterval(async () => {
      if (document.hidden) return;
      const r = await api.get<StepperStateView>('/lab/stepper/state');
      if (r.ok && r.body.scenarioId) setState(r.body);
    }, STATE_POLL_MS);
    return () => clearInterval(id);
  }, [scenarioId, connected, anyBusy]);

  // Leaving the page must not leave open transactions behind: their row locks (account rows) would block
  // Concurrency Lab runs and the test suite. Reset rolls both transactions back.
  const openRef = useRef(false);
  openRef.current = !!state && (state.txns.T1.cursor > 0 || state.txns.T2.cursor > 0) && !(state.txns.T1.killed && state.txns.T2.killed);
  useEffect(() => () => { if (openRef.current) void api.post('/lab/stepper/reset', {}); }, []);

  const adopt = useCallback((s: StepperStateView) => { setState(s); setLastWaits([]); setInvariant(null); }, []);

  const post = useCallback(async <T,>(path: string, body: unknown, onOk: (b: T) => void) => {
    setError(null);
    const r = await api.post<T>(path, body);
    if (r.ok) onOk(r.body); else setError(errorMessage(r));
    return r.ok;
  }, []);

  const load = useCallback(async () => {
    if (!selectedId) return;
    setBusy(true);
    await post<StepperStateView>('/lab/stepper/load', { scenarioId: selectedId }, adopt);
    setBusy(false);
  }, [selectedId, post, adopt]);

  const reset = useCallback(async () => {
    setBusy(true);
    await post<StepperStateView>('/lab/stepper/reset', {}, adopt);
    setBusy(false);
  }, [post, adopt]);

  const step = useCallback(async (txn: TxnLabel) => {
    await post<StepResultView>('/lab/stepper/step', { txn }, (res) => setState((s) => (s ? applyStepResponse(s, txn, res) : s)));
  }, [post]);

  const kill = useCallback(async (txn: TxnLabel) => {
    setBusy(true);
    await post<StepperStateView>('/lab/stepper/kill', { txn }, (s) => setState(s));
    setBusy(false);
  }, [post]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { retry, scenarios, selectedId, setSelectedId, state, locks, lastWaits, invariant, busy, error, connected, offline, load, reset, step, kill };
}
