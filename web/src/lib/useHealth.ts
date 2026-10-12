import { useCallback, useEffect, useRef, useState } from 'react';
import type { HealthResponse } from '@datasim/shared';
import { api } from './api';

export interface HealthState {
  /** Latest health payload, or null before the first answer / when the API is unreachable. */
  health: HealthResponse | null;
  /** True when the API did not answer with a health payload. */
  offline: boolean;
  /** True until the first response. */
  loading: boolean;
  refresh: () => void;
}

/** Polls GET /api/health (every 5 s by default; paused while the tab is hidden). */
export function useHealth(intervalMs = 5000): HealthState {
  const [state, setState] = useState<Omit<HealthState, 'refresh'>>({ health: null, offline: false, loading: true });
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const res = await api.get<HealthResponse>('/health');
    if (!alive.current) return;
    // 503 still carries a payload (MySQL down); a proxy error carries none.
    const ok = res.status !== 0 && typeof (res.body as Partial<HealthResponse>)?.mysql === 'object';
    setState({ health: ok ? res.body : null, offline: !ok, loading: false });
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const t = setInterval(() => { if (!document.hidden) void refresh(); }, intervalMs);
    const onVis = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive.current = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [refresh, intervalMs]);

  return { ...state, refresh: () => void refresh() };
}
