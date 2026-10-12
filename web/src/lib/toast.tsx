import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastTone = 'info' | 'success' | 'error';
interface ToastItem { id: number; tone: ToastTone; title: string; description?: string; leaving: boolean }

export interface ToastApi {
  /** Generic toast. */
  (title: string, opts?: { description?: string; tone?: ToastTone; durationMs?: number }): void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

const ICON = { info: Info, success: CheckCircle2, error: AlertCircle } as const;
const TONE = { info: 'text-info', success: 'text-ok', error: 'text-bad' } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 160);
  }, []);

  const api = useMemo<ToastApi>(() => {
    const push: ToastApi = ((title, opts) => {
      const id = nextId.current++;
      const tone = opts?.tone ?? 'info';
      setItems((xs) => [...xs.slice(-3), { id, tone, title, description: opts?.description, leaving: false }]);
      setTimeout(() => dismiss(id), opts?.durationMs ?? (tone === 'error' ? 7000 : 4000));
    }) as ToastApi;
    push.success = (t, d) => push(t, { description: d, tone: 'success' });
    push.error = (t, d) => push(t, { description: d, tone: 'error' });
    push.info = (t, d) => push(t, { description: d, tone: 'info' });
    return push;
  }, [dismiss]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2" role="region" aria-label="Notifications">
        {items.map((t) => {
          const Icon = ICON[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              style={{ animation: t.leaving ? undefined : 'ds-toast-in 180ms var(--ease)' }}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 transition-all duration-150 ease-out ${t.leaving ? 'translate-y-1 opacity-0' : ''}`}
            >
              <Icon size={16} strokeWidth={1.5} className={`mt-px shrink-0 ${TONE[t.tone]}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-fg">{t.title}</div>
                {t.description && <div className="mt-0.5 text-xs text-muted">{t.description}</div>}
              </div>
              <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="-mr-1 rounded p-0.5 text-faint transition-colors hover:text-fg">
                <X size={14} strokeWidth={1.5} />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

/** `const toast = useToast(); toast.success('Saved'); toast.error('Run failed', message);` */
export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast must be used inside <ToastProvider>');
  return c;
}
