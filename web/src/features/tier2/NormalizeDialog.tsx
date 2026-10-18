// Normalization assistant: closure calculator, keys, normal form, minimal cover, BCNF decomposition, 3NF synthesis, and "Apply" to the design schema.
import { AlertTriangle, Check, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { normalize, type Decomposition, type Fragment, type NormalForm, type NormalizeResult } from '@datasim/shared';
import { useDesignStore } from '../../lib/designStore';
import { Button, Dialog, Field, inputClass, Pill, Select, Switch, Tabs, TabsContent, TabsList, TabsTrigger, cn, useToast, type Tone } from '../../ui';
import { applyDecomposition, previewDecomposition, workloadMentions, type ApplyResult } from './applyDecomposition';
import { checkAttributes, closureTrace, defaultFds, EXAMPLES, fdText, lostDependencies, parseAttrList, parseFdsFor } from './normalizeView';

const UNIVERSAL = '__universal__';
const NF_ORDER: NormalForm[] = ['1NF', '2NF', '3NF', 'BCNF'];
const NF_TONE: Record<NormalForm, Tone> = { '1NF': 'red', '2NF': 'amber', '3NF': 'amber', BCNF: 'green' };

// ---------------------------------------------------------------- small pieces
function Card({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface-2 p-3', className)}>
      <div className="mb-2 flex min-h-5 items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-fg">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
const Note = ({ children }: { children: ReactNode }) => <p className="mb-2 text-xs leading-relaxed text-muted">{children}</p>;

function Attrs({ attrs, key_, className }: { attrs: string[]; key_?: string[]; className?: string }) {
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {attrs.map((a) => (
        <span key={a} className={cn('rounded border border-line bg-surface px-1.5 py-px font-mono text-xs', key_?.includes(a) ? 'text-fg underline decoration-accent decoration-2 underline-offset-2' : 'text-muted')}>{a}</span>
      ))}
    </span>
  );
}
const Fd = ({ lhs, rhs }: { lhs: string[]; rhs: string[] }) => (
  <span className="font-mono text-xs text-fg">{lhs.join(', ')} <span className="text-faint">{'→'}</span> {rhs.join(', ')}</span>
);

// ---------------------------------------------------------------- analysis tab
function NormalFormCard({ r }: { r: NormalizeResult }) {
  const reached = NF_ORDER.indexOf(r.highestNormalForm);
  const why: Record<NormalForm, string> = {
    BCNF: 'Every non-trivial dependency has a superkey on its left side.',
    '3NF': 'Every non-prime attribute depends on a key, but at least one determinant is not a superkey (BCNF fails because its right side is prime).',
    '2NF': 'No partial dependency on a key, but a non-prime attribute depends transitively on the key (3NF fails).',
    '1NF': 'A non-prime attribute depends on only part of a candidate key (partial dependency, 2NF fails). Atomic values are assumed.',
  };
  return (
    <Card title="Normal form" aside={<Pill tone={NF_TONE[r.highestNormalForm]} mono>{r.highestNormalForm}</Pill>}>
      <div className="mb-2 grid grid-cols-4 gap-1" role="img" aria-label={`Highest normal form: ${r.highestNormalForm}`}>
        {NF_ORDER.map((nf, i) => (
          <div key={nf} className={cn('flex h-7 items-center justify-center gap-1 rounded-md border font-mono text-xs', i <= reached ? (i === reached ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line bg-surface-3 text-fg') : 'border-line text-faint')}>
            {i <= reached ? <Check size={12} /> : <X size={12} />}{nf}
          </div>
        ))}
      </div>
      <Note>{why[r.highestNormalForm]}</Note>
      {r.violations.length > 0 && (
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-3 text-muted"><tr><th className="h-7 px-2 font-medium">Violating FD</th><th className="h-7 px-2 font-medium">Breaks</th><th className="h-7 px-2 font-medium">Why</th></tr></thead>
            <tbody className="divide-y divide-line bg-surface">
              {r.violations.map((v, i) => (
                <tr key={i} className="align-top">
                  <td className="px-2 py-1.5"><Fd lhs={v.fd.lhs} rhs={v.fd.rhs} /></td>
                  <td className="px-2 py-1.5"><span className="flex gap-1">{v.violates.map((n) => <Pill key={n} tone="red" mono>{n}</Pill>)}</span></td>
                  <td className="px-2 py-1.5 leading-relaxed text-muted">{v.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function KeysCard({ r }: { r: NormalizeResult }) {
  return (
    <Card title="Candidate keys and prime attributes">
      <Note>A candidate key is a minimal set of attributes whose closure is the whole relation. Attributes that occur in some candidate key are prime.</Note>
      <div className="grid grid-cols-[88px_1fr] items-start gap-x-3 gap-y-2 text-xs">
        <span className="pt-0.5 text-muted">Candidate keys</span>
        <div className="flex flex-wrap gap-2">
          {r.candidateKeys.map((k, i) => <span key={i} className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/5 px-1.5 py-0.5"><span className="text-faint">{'{'}</span><Attrs attrs={k} /><span className="text-faint">{'}'}</span></span>)}
        </div>
        <span className="pt-0.5 text-muted">Prime</span>
        <Attrs attrs={r.primeAttributes} />
        <span className="pt-0.5 text-muted">Non-prime</span>
        {r.nonPrimeAttributes.length ? <Attrs attrs={r.nonPrimeAttributes} /> : <span className="text-faint">none</span>}
      </div>
    </Card>
  );
}

function ClosureCard({ attrs, fds, text, onText }: { attrs: string[]; fds: NormalizeResult['minimalCover']; text: string; onText: (v: string) => void }) {
  const start = parseAttrList(text);
  const unknown = start.filter((a) => !attrs.includes(a));
  const trace = useMemo(() => (start.length && !unknown.length ? closureTrace(attrs, fds, start) : null), [attrs, fds, text]); // eslint-disable-line react-hooks/exhaustive-deps
  const isSuper = trace ? trace.result.length === attrs.length : false;
  return (
    <Card title="Attribute closure" aside={trace && <Pill tone={isSuper ? 'green' : 'neutral'}>{isSuper ? 'superkey' : 'not a superkey'}</Pill>}>
      <Note>X<sup>+</sup> is every attribute that X determines, directly or through other dependencies. If X<sup>+</sup> is the whole relation, X is a superkey.</Note>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-xs text-muted">X =</span>
        <input aria-label="Attributes to close" value={text} onChange={(e) => onText(e.target.value)} placeholder="A, B" spellCheck={false} className={cn(inputClass, 'h-7 max-w-[240px] font-mono text-xs')} />
      </div>
      {unknown.length > 0 && <p className="text-xs text-bad">Not in the relation: {unknown.join(', ')}</p>}
      {trace && (
        <ol className="flex flex-col gap-1 text-xs">
          <li className="flex items-center gap-2 text-muted"><span className="w-12 text-faint">start</span><Attrs attrs={trace.start} /></li>
          {trace.steps.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-muted">
              <span className="w-12 text-faint">step {i + 1}</span>
              <Fd lhs={s.fd.lhs} rhs={s.fd.rhs} /><span>adds</span><Attrs attrs={s.added} />
            </li>
          ))}
          <li className="mt-1 flex items-center gap-2 border-t border-line pt-1.5 text-fg"><span className="w-12 font-mono text-faint">X<sup>+</sup></span><Attrs attrs={trace.result} key_={trace.result} /></li>
          {!isSuper && <li className="pl-14 text-muted">Missing: {attrs.filter((a) => !trace.result.includes(a)).join(', ')}</li>}
        </ol>
      )}
    </Card>
  );
}

function CoverCard({ r }: { r: NormalizeResult }) {
  return (
    <Card title="Minimal cover">
      <Note>An equivalent set of FDs with single attributes on the right, no extraneous attribute on the left and no redundant FD. 3NF synthesis starts from it.</Note>
      {r.minimalCover.length === 0 ? <p className="text-xs text-faint">No dependencies.</p> : (
        <ul className="flex flex-col gap-1">{r.minimalCover.map((f, i) => <li key={i}><Fd lhs={f.lhs} rhs={f.rhs} /></li>)}</ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- decomposition tab
function Property({ ok, title, children }: { ok: boolean; title: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-lg border p-3', ok ? 'border-ok/30 bg-ok/5' : 'border-warn/30 bg-warn/5')}>
      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-fg">
        {ok ? <Check size={14} className="text-ok" /> : <AlertTriangle size={14} className="text-warn" />}{title}
        <Pill tone={ok ? 'green' : 'amber'} className="ml-auto">{ok ? 'yes' : 'no'}</Pill>
      </div>
      <div className="text-xs leading-relaxed text-muted">{children}</div>
    </div>
  );
}

function ApplyPlan({ plan, error }: { plan: ApplyResult | null; error: string | null }) {
  if (error) return <p className="text-xs text-bad">{error}</p>;
  if (!plan) return null;
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <table className="w-full text-left text-xs">
        <thead className="bg-surface-3 text-muted"><tr><th className="h-7 px-2 font-medium">New table</th><th className="h-7 px-2 font-medium">Columns</th><th className="h-7 px-2 font-medium">Primary key</th><th className="h-7 px-2 font-medium">References</th></tr></thead>
        <tbody className="divide-y divide-line bg-surface">
          {plan.tables.map((t) => (
            <tr key={t.name} className="align-top">
              <td className="px-2 py-1.5 font-mono text-fg">{t.name}</td>
              <td className="px-2 py-1.5 text-muted">{t.attributes.length}</td>
              <td className="px-2 py-1.5 font-mono text-muted">{t.primaryKey.join(', ')}</td>
              <td className="px-2 py-1.5 font-mono text-muted">{t.foreignKeys.length ? t.foreignKeys.map((f) => `${f.columns.join(', ')} → ${f.refTable}`).join('; ') : <span className="text-faint">-</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface DecompositionViewProps {
  kind: 'BCNF' | '3NF';
  d: Decomposition;
  attrs: string[];
  fdsGiven: NormalizeResult['minimalCover'];
  plan: ApplyResult | null;
  planError: string | null;
  sourceTable: string | null;
  replace: boolean;
  canReplace: boolean;
  onReplace: (v: boolean) => void;
  mentions: string[];
  partial: boolean;
}
function DecompositionView({ kind, d, attrs, fdsGiven, plan, planError, sourceTable, replace, canReplace, onReplace, mentions, partial }: DecompositionViewProps) {
  const lost = useMemo(() => lostDependencies(attrs, fdsGiven, d.relations.map((r) => r.attributes)), [attrs, fdsGiven, d]);
  const single = d.relations.length === 1;
  return (
    <div className="flex flex-col gap-3">
      <Card title={kind === 'BCNF' ? 'BCNF decomposition' : '3NF synthesis'}>
        <Note>
          {kind === 'BCNF'
            ? 'While some relation has a non-trivial FD X → Y with X not a superkey, split it into X⁺ and the rest plus X. The result is always lossless, but a dependency may no longer be enforceable inside one table.'
            : 'Take a minimal cover, make one relation per distinct left side, drop relations contained in others, and add a candidate-key relation if none contains a key. The result is lossless and preserves every dependency.'}
        </Note>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-xs text-muted marker:text-faint">
          {d.steps.map((s, i) => <li key={i} className="leading-relaxed">{s}</li>)}
        </ol>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        {d.relations.map((rel: Fragment, i) => (
          <div key={i} className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-sm text-fg">R{i + 1}</span>
              <span className="text-xs text-faint">{rel.attributes.length} attributes</span>
            </div>
            <Attrs attrs={rel.attributes} key_={rel.keys[0]} className="mb-2" />
            <div className="grid grid-cols-[40px_1fr] gap-x-2 gap-y-1 text-xs">
              <span className="text-muted">Key</span>
              <span className="flex flex-wrap gap-1.5">{rel.keys.map((k, j) => <span key={j} className="rounded border border-accent/30 bg-accent/5 px-1.5 font-mono text-fg">{k.join(', ')}</span>)}</span>
              <span className="text-muted">FDs</span>
              {rel.fds.length ? <span className="flex flex-col gap-0.5">{rel.fds.map((f, j) => <Fd key={j} lhs={f.lhs} rhs={f.rhs} />)}</span> : <span className="text-faint">none</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Property ok={d.losslessJoin} title="Lossless join">
          {d.losslessJoin
            ? 'The tableau chase ends with a row of plain symbols, so joining the relations gives back exactly the original tuples.'
            : 'The chase never reaches an all-plain row: joining the relations can produce tuples the original did not contain (spurious tuples).'}
        </Property>
        <Property ok={d.preservesDependencies} title="Dependency preserving">
          {d.preservesDependencies
            ? 'Every given FD follows from the FDs that hold inside the individual relations, so each can be enforced by a key or constraint on one table.'
            : <>These FDs cannot be enforced inside a single table (enforcing them needs a join): <span className="mt-1 flex flex-col gap-0.5">{lost.map((f, i) => <span key={i} className="font-mono text-fg">{fdText(f)}</span>)}</span></>}
        </Property>
      </div>

      <Card title="Apply to the schema" aside={sourceTable ? <span className="font-mono text-xs text-faint">{sourceTable}</span> : <span className="text-xs text-faint">new tables</span>}>
        {single && sourceTable ? (
          <p className="text-xs text-muted">The relation is already in {kind === 'BCNF' ? 'BCNF' : '3NF'} for these dependencies, so there is nothing to change.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <Note>Creates one table per relation with the key as primary key, foreign keys from each relation to the relation holding its key, and column types copied from the source{sourceTable ? '' : ' (guessed from names: ids become INT, the rest VARCHAR(80))'}. It is one undo step.</Note>
            <ApplyPlan plan={plan} error={planError} />
            {sourceTable && (
              <label className="flex items-center gap-2 text-xs text-fg">
                <Switch checked={replace} disabled={!canReplace} onCheckedChange={onReplace} aria-label={`Replace ${sourceTable}`} />
                Replace <span className="font-mono">{sourceTable}</span> with these tables
                {!canReplace && <span className="text-faint">{partial ? '(only some columns are analysed, so the original stays)' : ''}</span>}
              </label>
            )}
            {sourceTable && replace && mentions.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-warn"><AlertTriangle size={14} className="mt-px shrink-0" />The workload references {sourceTable} in {mentions.join(', ')}. Update that SQL after applying.</p>
            )}
            {plan?.warnings.map((w) => <p key={w} className="flex items-start gap-1.5 text-xs text-warn"><AlertTriangle size={14} className="mt-px shrink-0" />{w}</p>)}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- dialog
export interface NormalizeDialogProps { open: boolean; onOpenChange: (open: boolean) => void; onApplied?: (created: string[]) => void; initialTable?: string }

export function NormalizeDialog({ open, onOpenChange, onApplied, initialTable }: NormalizeDialogProps) {
  const toast = useToast();
  const design = useDesignStore((s) => s.design);
  const update = useDesignStore((s) => s.update);
  const tables = design.schema.tables;

  const first = EXAMPLES[0]!;
  const [source, setSource] = useState<string>(UNIVERSAL);
  const [attrText, setAttrText] = useState(first.attributes.join(', '));
  const [excluded, setExcluded] = useState<string[]>([]);
  const [fdText_, setFdText] = useState(first.fds);
  const [exampleId, setExampleId] = useState<string>(first.id);
  const [closureText, setClosureText] = useState('A');
  const [tab, setTab] = useState('analysis');
  const [replace, setReplace] = useState(true);

  // Opening from a table's context preselects it.
  useEffect(() => {
    if (!open || !initialTable) return;
    const t = tables.find((x) => x.name === initialTable);
    if (t) pickSource(t.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTable]);

  const table = source === UNIVERSAL ? null : tables.find((t) => t.name === source) ?? null;
  useEffect(() => { if (source !== UNIVERSAL && !table) setSource(UNIVERSAL); }, [source, table]);

  const attributes = useMemo(() => (table ? table.columns.map((c) => c.name).filter((c) => !excluded.includes(c)) : parseAttrList(attrText)), [table, excluded, attrText]);
  const attrError = checkAttributes(attributes);
  const parsed = useMemo(() => (attrError ? null : parseFdsFor(fdText_, attributes)), [attrError, fdText_, attributes]);
  const result = useMemo(() => {
    if (!parsed || !parsed.ok) return null;
    try { return normalize(attributes, parsed.fds); } catch { return null; }
  }, [parsed, attributes]);
  const fdError = attrError ?? (parsed && !parsed.ok ? parsed.error : null);
  const givenFds = parsed && parsed.ok ? parsed.fds : [];

  const partial = !!table && excluded.length > 0;
  const canReplace = !!table && !partial;
  const doReplace = canReplace && replace;
  const activeKind: 'BCNF' | '3NF' | null = tab === 'bcnf' ? 'BCNF' : tab === '3nf' ? '3NF' : null;
  const decomposition = result && activeKind ? (activeKind === 'BCNF' ? result.bcnf : result.threeNf) : null;

  const { plan, planError } = useMemo(() => {
    if (!decomposition) return { plan: null, planError: null };
    try { return { plan: previewDecomposition(design.schema, { sourceTable: table?.name ?? null, fragments: decomposition.relations, replaceSource: doReplace }), planError: null }; }
    catch (e) { return { plan: null, planError: (e as Error).message }; }
  }, [decomposition, design.schema, table, doReplace]);
  const mentions = useMemo(() => (table ? workloadMentions(design, table.name) : []), [design, table]);

  function pickSource(name: string) {
    setSource(name); setExcluded([]); setTab('analysis'); setExampleId('');
    const t = tables.find((x) => x.name === name);
    if (t) { setFdText(defaultFds(t)); setClosureText(t.primaryKey.join(', ')); }
  }
  function pickExample(id: string) {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    setSource(UNIVERSAL); setExcluded([]); setAttrText(ex.attributes.join(', ')); setFdText(ex.fds); setExampleId(id); setClosureText(ex.attributes[0]!); setTab('analysis');
  }

  const canApply = !!decomposition && !!plan && !planError && !(table && decomposition.relations.length === 1);
  const apply = () => {
    if (!decomposition || !activeKind) return;
    let res: ApplyResult | null = null;
    try {
      update((d) => { res = applyDecomposition(d.schema, { sourceTable: table?.name ?? null, fragments: decomposition.relations, replaceSource: doReplace }); });
    } catch (e) { toast.error('Could not apply decomposition', (e as Error).message); return; }
    const done = res as ApplyResult | null;
    if (!done) return;
    toast.success(`${activeKind} decomposition applied`, `${done.created.length} table${done.created.length === 1 ? '' : 's'}: ${done.created.join(', ')}${done.removed ? `. Replaced ${done.removed}.` : ''}`);
    onOpenChange(false);
    onApplied?.(done.created);
  };

  const example = EXAMPLES.find((e) => e.id === exampleId);
  const sourceOptions = [{ value: UNIVERSAL, label: 'Universal relation (free attributes)' }, ...tables.map((t) => ({ value: t.name, label: t.name }))];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={1120}
      title="Normalization assistant"
      description="Enter functional dependencies to find keys and the normal form, then decompose into BCNF or 3NF and apply the result to your schema."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
          {activeKind && canApply && <Button variant="primary" onClick={apply} data-testid="apply-decomposition">Apply {activeKind} decomposition</Button>}
        </>
      }
    >
      <div className="grid h-[min(620px,calc(85vh-190px))] grid-cols-[308px_minmax(0,1fr)] gap-4">
        <div className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <Field label="Example">
            {(id) => <Select id={id} value={exampleId} placeholder="Load a textbook example" onValueChange={pickExample} options={EXAMPLES.map((e) => ({ value: e.id, label: e.label }))} />}
          </Field>
          {example && <p className="-mt-1.5 text-xs leading-relaxed text-faint">{example.note}</p>}
          <div className="h-px bg-line" />
          <Field label="Relation">
            {(id) => <Select id={id} value={source} onValueChange={pickSource} options={sourceOptions} />}
          </Field>
          {table ? (
            <Field label="Attributes (columns)" hint={partial ? 'Excluded columns are left out of the analysis.' : 'Click a column to leave it out.'}>
              <div className="flex flex-wrap gap-1">
                {table.columns.map((c) => {
                  const off = excluded.includes(c.name);
                  return (
                    <button key={c.name} type="button" aria-pressed={!off} onClick={() => setExcluded((x) => (off ? x.filter((n) => n !== c.name) : [...x, c.name]))}
                      className={cn('rounded border px-1.5 py-px font-mono text-xs transition-colors', off ? 'border-line text-faint line-through' : 'border-line-strong bg-surface-2 text-fg hover:border-accent')}>{c.name}</button>
                  );
                })}
              </div>
            </Field>
          ) : (
            <Field label="Attributes" hint="Comma-separated, up to 16.">
              {(id) => <input id={id} value={attrText} onChange={(e) => { setAttrText(e.target.value); setExampleId(''); }} spellCheck={false} placeholder="A, B, C, D" className={cn(inputClass, 'font-mono text-xs')} />}
            </Field>
          )}
          <Field label="Functional dependencies" error={fdError} hint={fdError ? undefined : 'One per line: A, B -> C, D'}>
            {(id) => (
              <textarea id={id} value={fdText_} onChange={(e) => { setFdText(e.target.value); setExampleId(''); }} rows={9} spellCheck={false} aria-invalid={!!fdError || undefined}
                placeholder={'A -> B\nB -> C'} className={cn(inputClass, 'h-auto resize-none py-2 font-mono text-xs leading-5')} />
            )}
          </Field>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col">
          {!result ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-line px-6 text-center text-sm text-muted">
              {fdError ?? 'Enter the attributes and dependencies to analyse.'}
            </div>
          ) : (
            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="shrink-0">
                <TabsTrigger value="analysis">Analysis</TabsTrigger>
                <TabsTrigger value="bcnf" count={result.bcnf.relations.length}>BCNF decomposition</TabsTrigger>
                <TabsTrigger value="3nf" count={result.threeNf.relations.length}>3NF synthesis</TabsTrigger>
              </TabsList>
              <TabsContent value="analysis" className="min-h-0 flex-1 overflow-auto pt-3">
                <div className="flex flex-col gap-3 pr-1">
                  <NormalFormCard r={result} />
                  <KeysCard r={result} />
                  <ClosureCard attrs={attributes} fds={givenFds} text={closureText} onText={setClosureText} />
                  <CoverCard r={result} />
                </div>
              </TabsContent>
              {(['bcnf', '3nf'] as const).map((k) => (
                <TabsContent key={k} value={k} className="min-h-0 flex-1 overflow-auto pt-3">
                  <div className="pr-1">
                    <DecompositionView
                      kind={k === 'bcnf' ? 'BCNF' : '3NF'} d={k === 'bcnf' ? result.bcnf : result.threeNf} attrs={attributes} fdsGiven={givenFds}
                      plan={tab === k ? plan : null} planError={planError} sourceTable={table?.name ?? null}
                      replace={doReplace} canReplace={canReplace} onReplace={setReplace} mentions={mentions} partial={partial}
                    />
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      </div>
    </Dialog>
  );
}
