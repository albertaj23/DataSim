import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'datasim-theme';

interface ThemeCtx { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void }
const Ctx = createContext<ThemeCtx>({ theme: 'dark', setTheme: () => undefined, toggle: () => undefined });

/** Saved choice, else dark (the product is dark-first; the OS preference is deliberately ignored). (index.html applies the same logic before first paint.) */
function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage blocked */ }
  return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, set] = useState<Theme>(initial);
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  const setTheme = useCallback((t: Theme) => {
    set(t);
    try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  }, []);
  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);
  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
