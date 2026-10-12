import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { IconButton, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '../../ui';
import { LiveTab } from './panel/LiveTab';
import { FindingsTab, InvariantsTab, LocksTab, LogTab, StatementsTab, TransactionsTab } from './panel/ReportTabs';
import type { useRunActions } from './runFlow';
import { isActive, useRunStore } from './runStore';
import { PANEL_HEADER, PANEL_TABS, clampPanel, useStudioUi, type PanelTab } from './studioUi';

const LABEL: Record<PanelTab, string> = { live: 'Live', transactions: 'Transactions', statements: 'Statements', locks: 'Locks', invariants: 'Invariants', findings: 'Findings', log: 'Log' };

export function BottomPanel({ run }: { run: ReturnType<typeof useRunActions> }) {
  const open = useStudioUi((s) => s.panelOpen);
  const height = useStudioUi((s) => s.panelHeight);
  const tab = useStudioUi((s) => s.tab);
  const report = useRunStore((s) => s.report);
  const runId = useRunStore((s) => s.runId);
  const active = useRunStore(isActive);
  const dragging = useRef(false);
  const el = useRef<HTMLElement>(null);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY; const startH = height;
    dragging.current = true;
    el.current?.style.setProperty('transition', 'none');
    const move = (ev: PointerEvent) => {
      const h = clampPanel(startH + (startY - ev.clientY), window.innerHeight);
      useStudioUi.setState({ panelHeight: h, panelOpen: true });
    };
    const up = () => {
      dragging.current = false;
      el.current?.style.removeProperty('transition');
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const counts: Partial<Record<PanelTab, number>> = report ? {
    transactions: report.txnStats.length, statements: report.statementStats.length, locks: report.lockWaits.length,
    invariants: report.invariants.filter((i) => !i.passed).length, findings: report.findings.length,
  } : {};
  const run_ = report?.run;

  return (
    <section
      ref={el} aria-label="Run panel" data-testid="bottom-panel"
      style={{ height: open ? height : PANEL_HEADER }}
      className="relative flex shrink-0 flex-col border-t border-line bg-surface transition-[height] duration-150 ease-out"
    >
      {open && <div role="separator" aria-orientation="horizontal" aria-label="Resize panel" onPointerDown={startDrag} className="absolute -top-1 left-0 z-10 h-2 w-full cursor-row-resize" />}
      <Tabs value={tab} onValueChange={(v) => useStudioUi.getState().setTab(v as PanelTab)} className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-[33px] shrink-0 items-center border-b border-line pl-2 pr-1.5">
          <TabsList className="border-b-0">
            {PANEL_TABS.map((t) => (
              <TabsTrigger key={t} value={t} onClick={() => useStudioUi.getState().openPanel(t)} count={counts[t] || undefined} className={cn('h-[33px]', t === 'live' && active && 'after:ml-0.5 after:inline-block after:h-1.5 after:w-1.5 after:rounded-full after:bg-info')}>
                {LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="ml-auto flex items-center gap-2">
            {run_ && runId && (
              <Link to={`/runs/${runId}`} className="flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-fg">
                run {runId.slice(0, 8)} &middot; rev {run_.revisionNo} &middot; {run_.kind.toLowerCase()} &middot; {run_.strategy}
                <ExternalLink size={11} />
              </Link>
            )}
            <IconButton size="sm" label={open ? 'Collapse panel' : 'Expand panel'} icon={open ? <ChevronDown size={14} /> : <ChevronUp size={14} />} onClick={() => useStudioUi.getState().togglePanel()} />
          </div>
        </div>
        {open && (
          <div className="min-h-0 flex-1">
            <TabsContent value="live" className="h-full"><LiveTab run={run} /></TabsContent>
            <TabsContent value="transactions" className="h-full"><TransactionsTab report={report} /></TabsContent>
            <TabsContent value="statements" className="h-full"><StatementsTab report={report} /></TabsContent>
            <TabsContent value="locks" className="h-full"><LocksTab report={report} /></TabsContent>
            <TabsContent value="invariants" className="h-full"><InvariantsTab report={report} /></TabsContent>
            <TabsContent value="findings" className="h-full"><FindingsTab report={report} /></TabsContent>
            <TabsContent value="log" className="h-full"><LogTab /></TabsContent>
          </div>
        )}
      </Tabs>
    </section>
  );
}
