import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  type ProvisionProgressEvent,
  type RunFinishedEvent,
  type RunLocksEvent,
  type RunSampleEvent,
  type RunStatusEvent,
} from '@datasim/shared';

let socket: Socket | null = null;
/** Rooms we want to be in (ref-counted). Re-joined on every (re)connect: the server forgets rooms on disconnect. */
const rooms = new Map<string, number>();

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });
    socket.on('connect', () => {
      for (const runId of rooms.keys()) socket!.emit('join_run', { runId });
    });
  }
  return socket;
}

/** Join `run:<runId>`; returns a leave function. Safe to call repeatedly (ref-counted). */
export function joinRun(runId: string): () => void {
  const s = getSocket();
  const n = rooms.get(runId) ?? 0;
  rooms.set(runId, n + 1);
  if (n === 0 && s.connected) s.emit('join_run', { runId });
  return () => {
    const left = (rooms.get(runId) ?? 1) - 1;
    if (left > 0) { rooms.set(runId, left); return; }
    rooms.delete(runId);
    if (s.connected) s.emit('leave_run', { runId });
  };
}

export interface RunEventHandlers {
  onStatus?: (e: RunStatusEvent) => void;
  onProgress?: (e: ProvisionProgressEvent) => void;
  onSample?: (e: RunSampleEvent) => void;
  onLocks?: (e: RunLocksEvent) => void;
  onFinished?: (e: RunFinishedEvent) => void;
}

/**
 * Subscribe to a run's live events. Handlers may change every render (kept in a ref);
 * events for other runs are ignored. Pass null to stay idle.
 */
export function useRunEvents(runId: string | null | undefined, handlers: RunEventHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!runId) return;
    const s = getSocket();
    const leave = joinRun(runId);
    const wrap = <E extends { runId: string }>(pick: (h: RunEventHandlers) => ((e: E) => void) | undefined) =>
      (e: E) => { if (e.runId === runId) pick(ref.current)?.(e); };
    const onStatus = wrap<RunStatusEvent>((h) => h.onStatus);
    const onProgress = wrap<ProvisionProgressEvent>((h) => h.onProgress);
    const onSample = wrap<RunSampleEvent>((h) => h.onSample);
    const onLocks = wrap<RunLocksEvent>((h) => h.onLocks);
    const onFinished = wrap<RunFinishedEvent>((h) => h.onFinished);
    s.on(SOCKET_EVENTS.status, onStatus);
    s.on(SOCKET_EVENTS.progress, onProgress);
    s.on(SOCKET_EVENTS.sample, onSample);
    s.on(SOCKET_EVENTS.locks, onLocks);
    s.on(SOCKET_EVENTS.finished, onFinished);
    return () => {
      s.off(SOCKET_EVENTS.status, onStatus);
      s.off(SOCKET_EVENTS.progress, onProgress);
      s.off(SOCKET_EVENTS.sample, onSample);
      s.off(SOCKET_EVENTS.locks, onLocks);
      s.off(SOCKET_EVENTS.finished, onFinished);
      leave();
    };
  }, [runId]);
}

/** Join the Transaction Stepper room and forward `stepper_update` pushes. Reconnect-safe. */
export function useStepperRoom<T>(onUpdate: (u: T) => void): void {
  const ref = useRef(onUpdate);
  ref.current = onUpdate;
  useEffect(() => {
    const s = getSocket();
    const join = () => s.emit('join_stepper', {});
    const cb = (u: T) => ref.current(u);
    if (s.connected) join();
    s.on('connect', join);
    s.on('stepper_update', cb);
    return () => { s.off('connect', join); s.off('stepper_update', cb); };
  }, []);
}
