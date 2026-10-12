import { ArrowLeft, ArrowRight, Plus, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { RunReport, RunSummary } from '@datasim/shared';
import { formatNumber, relativeTime } from '../../lib/format';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, IconButton, Pill, buttonClass } from '../../ui';
import { RUN_COLORS } from './CompareCharts';
import { MAX_COMPARE, runLetter } from './diff';

/** One card per compared run: colour key, label, verdict, quick facts, reorder / remove. */
export function RunStrip({ runs, labels, candidates, onMove, onRemove, onAdd }: {
  runs: RunReport[]; labels: string[]; candidates: RunSummary[]; onMove: (from: number, to: number) => void; onRemove: (id: string) => void; onAdd: (id: string) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-stretch gap-2" data-testid="run-strip">
      {runs.map((r, i) => {
        const { run, slo } = r;
        return (
          <div key={run.runId} className="flex min-w-[220px] flex-1 flex-col gap-1.5 rounded-lg border border-line bg-surface px-3 py-2.5" style={{ borderTopColor: RUN_COLORS[i], borderTopWidth: 2 }} data-testid="run-card">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[11px] font-medium" style={{ background: `color-mix(in srgb, ${RUN_COLORS[i]} 18%, transparent)`, color: RUN_COLORS[i] }}>{runLetter(i)}</span>
              <Link to={`/runs/${run.runId}`} className="min-w-0 flex-1 truncate font-mono text-sm text-fg hover:text-accent" title="Open the full report">{labels[i]}</Link>
              <span className="flex shrink-0 items-center">
                <IconButton size="sm" label="Move earlier" icon={<ArrowLeft size={14} />} disabled={i === 0} onClick={() => onMove(i, i - 1)} />
                <IconButton size="sm" label="Move later" icon={<ArrowRight size={14} />} disabled={i === runs.length - 1} onClick={() => onMove(i, i + 1)} />
                <IconButton size="sm" label="Remove from comparison" icon={<X size={14} />} onClick={() => onRemove(run.runId)} />
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {slo ? <Pill tone={slo.pass ? 'green' : 'red'}>{slo.pass ? 'PASS' : 'FAIL'}</Pill> : <Pill>no verdict</Pill>}
              <Pill mono>{run.isolation}</Pill><Pill mono>{run.vus} VUs</Pill><Pill mono>{run.durationS} s</Pill>
            </div>
            <div className="text-[11px] text-faint">{run.startedAt ? relativeTime(run.startedAt) : '-'} · {formatNumber(run.txnTotal)} transactions · seed {run.seed}</div>
          </div>
        );
      })}
      {runs.length < MAX_COMPARE && (
        <DropdownMenu>
          <DropdownMenuTrigger className={buttonClass('secondary', 'md', 'min-h-[88px] min-w-[120px] flex-col border-dashed')} disabled={candidates.length === 0} data-testid="add-run"><Plus size={16} />Add run</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[320px] min-w-[260px] overflow-auto">
            <DropdownMenuLabel>Completed runs of this project</DropdownMenuLabel>
            {candidates.slice(0, 20).map((c) => (
              <DropdownMenuItem key={c.runId} onSelect={() => onAdd(c.runId)}>
                <span className="font-mono">{c.strategy} · rev {c.revisionNo}</span><span className="ml-2 text-xs text-faint">{c.startedAt ? relativeTime(c.startedAt) : ''}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

