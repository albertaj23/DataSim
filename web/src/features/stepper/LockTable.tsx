import type { LockRow, LockSnapshot } from '../../lib/labApi';
import { Pill, ProvenanceTag, Table, TBody, TD, TH, THead, TR, type Tone } from '../../ui';
import { reviewName } from '../lab/logic';
import { Panel } from '../lab/widgets';

const OWNER_TONE: Record<LockRow['label'], Tone> = { T1: 'accent', T2: 'blue', other: 'neutral' };

const LOCK_MODES: [string, string][] = [
  ['IX', 'table-level intention lock (multi-granularity locking)'],
  ['X,REC_NOT_GAP', 'record lock: exactly this row'],
  ['S / X', 'shared / exclusive next-key lock: the row and the gap before it'],
  ['X,GAP', 'gap lock only, no row'],
  ['X,INSERT_INTENTION', 'a pending INSERT waiting for a gap'],
];

/** Live InnoDB locks from performance_schema.data_locks for the datasim schema. */
export function LockTable({ locks, loaded }: { locks: LockSnapshot | null; loaded: boolean }) {
  const rows = locks?.locks ?? [];
  const waiting = rows.filter((l) => l.status === 'WAITING').length;
  return (
    <Panel
      title="Lock table"
      subtitle={`performance_schema.data_locks · polled every 500 ms${loaded ? ` · ${rows.length} lock${rows.length === 1 ? '' : 's'}${waiting ? `, ${waiting} waiting` : ''}` : ''}`}
      actions={<ProvenanceTag kind="MEASURED" />}
      flush
    >
      <div className="max-h-[320px] overflow-auto [&>div]:overflow-visible [&>div]:rounded-none [&>div]:border-0">
        <Table aria-label="InnoDB locks">
          <THead>
            <tr>
              <TH>Txn</TH><TH>Table</TH><TH>Index</TH><TH>Type</TH><TH>Mode</TH><TH>Status</TH><TH>Data</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((l, i) => (
              <TR key={i}>
                <TD><Pill tone={OWNER_TONE[l.label]} mono>{l.label}</Pill></TD>
                <TD>
                  <span className="text-fg">{reviewName(l.table)}</span>{' '}
                  <span className="font-mono text-xs text-faint">{l.table}</span>
                </TD>
                <TD mono className="text-xs">{l.index ?? '-'}</TD>
                <TD mono className="text-xs">{l.type}</TD>
                <TD mono className="text-xs">{l.mode}</TD>
                <TD><Pill tone={l.status === 'WAITING' ? 'amber' : 'green'}>{l.status}</Pill></TD>
                <TD mono className="text-xs text-muted">{l.data ?? '-'}</TD>
              </TR>
            ))}
            {rows.length === 0 && (
              <TR><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">{loaded ? 'No locks held right now. Run a statement to see its locks.' : 'Load a scenario to inspect locks.'}</td></TR>
            )}
          </TBody>
        </Table>
      </div>
      <details className="border-t border-line px-3.5 py-2">
        <summary className="cursor-pointer select-none text-xs text-muted hover:text-fg">Lock modes</summary>
        <dl className="mt-2 grid gap-x-6 gap-y-1 md:grid-cols-2">
          {LOCK_MODES.map(([mode, meaning]) => (
            <div key={mode} className="flex gap-2 text-xs">
              <dt className="shrink-0 font-mono text-fg">{mode}</dt>
              <dd className="text-muted">{meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-faint">Foreign key checks take <span className="font-mono">S,REC_NOT_GAP</span> locks on parent rows (clients, resources). Table names show Review 1 vocabulary; the legacy name is beside it.</p>
      </details>
    </Panel>
  );
}
