// Tiny command registry. Pages register their commands under an owner key; the palette lists what is registered right now.
import type { ReactNode } from 'react';
import { create } from 'zustand';

export interface Command {
  id: string;
  title: string;
  group: string;
  icon?: ReactNode;
  /** Extra search terms. */
  keywords?: string[];
  /** Display only, e.g. "Ctrl+Enter". The shortcut itself is bound elsewhere. */
  shortcut?: string;
  /** Evaluated each time the palette opens; false hides the command. */
  when?: () => boolean;
  run: () => void;
}

/** Display order of groups; unknown groups follow alphabetically. */
export const GROUP_ORDER = ['Run', 'Design', 'Add component', 'Strategy', 'Isolation', 'Editors', 'Panels', 'Export', 'Recent runs', 'Projects', 'Navigate', 'Appearance'];

interface Registry {
  sources: Record<string, Command[]>;
  set: (owner: string, cmds: Command[]) => void;
  clear: (owner: string) => void;
}
export const useCommandRegistry = create<Registry>()((set) => ({
  sources: {},
  set: (owner, cmds) => set((s) => ({ sources: { ...s.sources, [owner]: cmds } })),
  clear: (owner) => set((s) => { const { [owner]: _drop, ...rest } = s.sources; return { sources: rest }; }),
}));

/** Registers commands for `owner`; call the returned function to remove them. */
export function registerCommands(owner: string, cmds: Command[]): () => void {
  useCommandRegistry.getState().set(owner, cmds);
  return () => useCommandRegistry.getState().clear(owner);
}

/** Flattens every source, drops hidden commands and duplicate ids (first registration wins). */
export function collectCommands(sources: Record<string, Command[]>): Command[] {
  const seen = new Set<string>();
  const out: Command[] = [];
  for (const cmds of Object.values(sources)) {
    for (const c of cmds) {
      if (seen.has(c.id) || c.when?.() === false) continue;
      seen.add(c.id); out.push(c);
    }
  }
  return out;
}

export function groupCommands(cmds: Command[]): Array<{ group: string; items: Command[] }> {
  const rank = (g: string) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? GROUP_ORDER.length : i; };
  const groups = new Map<string, Command[]>();
  for (const c of cmds) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  return [...groups].map(([group, items]) => ({ group, items })).sort((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group));
}

/** Small cross-feature UI signals that are not worth threading through props. */
type Request = 'normalize' | 'query';
interface Tier2Ui { requested: Request | null; request: (r: Request) => void; consume: (r: Request) => boolean }
export const useTier2Ui = create<Tier2Ui>()((set, get) => ({
  requested: null,
  request: (requested) => set({ requested }),
  consume: (r) => { if (get().requested !== r) return false; set({ requested: null }); return true; },
}));
