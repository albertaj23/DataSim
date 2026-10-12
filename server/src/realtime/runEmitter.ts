// Run-scoped realtime events (Socket.IO room `run:<id>`). The engine calls emitRun(); socket.ts installs the sender.
export type RunEmitter = (runId: string, event: string, payload: unknown) => void;
let current: RunEmitter = () => {};
export const emitRun: RunEmitter = (runId, event, payload) => current(runId, event, payload);
export function setRunEmitter(fn: RunEmitter | null): void { current = fn ?? (() => {}); }
