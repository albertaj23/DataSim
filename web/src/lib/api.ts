// Thin typed wrapper around the REST API. Non-2xx responses are returned, not thrown
// (409 RUN_ACTIVE, 400 validation problems and so on are normal outcomes). Network
// failures resolve to { ok: false, status: 0 } so callers need only one code path.

export interface ApiResult<T> { ok: boolean; status: number; body: T }
export interface ApiErrorBody { code: string; message: string }

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, body: json };
  } catch (err) {
    const e: ApiErrorBody = { code: 'NETWORK', message: err instanceof Error ? err.message : 'Network error' };
    return { ok: false, status: 0, body: e as unknown as T };
  }
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => call<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => call<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => call<T>('DELETE', path),
};

/** Human message for a failed result: server `message`, else a status-based fallback. */
export function errorMessage(res: ApiResult<unknown>): string {
  const b = res.body as Partial<ApiErrorBody> | null;
  if (b && typeof b.message === 'string' && b.message) return b.message;
  if (res.status === 0) return 'API is offline';
  return `Request failed (${res.status})`;
}
