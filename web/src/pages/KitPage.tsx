import { Copy, Download, FileText, Play, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { PageContainer, PageHeader } from '../shell/Page';
import {
  Button, CodeBlock, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  EmptyState, Field, FormRow, HowMeasurementsWork, IconButton, Input, Kbd, NumberField, Overlay, Pill, Popover, PopoverContent,
  PopoverTrigger, ProvenanceTag, SectionHeader, Select, SortableTH, Skeleton, Slider, SplitButton, StatusDot, Switch, Table, TBody,
  TD, THead, TR, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip, sortRows, useToast, type SortState, type Tone,
} from '../ui';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <SectionHeader title={title} />
      <div className="rounded-[10px] border border-line bg-surface p-4">{children}</div>
    </section>
  );
}

const SQL = `CREATE TABLE \`section\` (
  \`section_id\` INT NOT NULL AUTO_INCREMENT,
  \`course_id\` INT NOT NULL,
  \`capacity\` SMALLINT NOT NULL CHECK (\`capacity\` > 0),
  \`enrolled\` SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (\`section_id\`)
) ENGINE=InnoDB;

-- seats left
SELECT section_id, capacity - enrolled AS seats_left FROM section WHERE slot = 'A1' LIMIT 20;`;

const ROWS = [
  { name: 'register', count: 18420, p95: 41.2, err: 0.4 },
  { name: 'search_sections', count: 12010, p95: 212.8, err: 0 },
  { name: 'my_timetable', count: 3390, p95: 18.1, err: 0 },
];

export default function KitPage() {
  const toast = useToast();
  const [n, setN] = useState(200);
  const [sel, setSel] = useState('REPEATABLE READ');
  const [on, setOn] = useState(true);
  const [sl, setSl] = useState(32);
  const [tab, setTab] = useState('live');
  const [dlg, setDlg] = useState(false);
  const [ovl, setOvl] = useState(false);
  const [sort, setSort] = useState<SortState<'name' | 'count' | 'p95'> | null>({ key: 'p95', dir: 'desc' });
  const tones: Tone[] = ['neutral', 'green', 'amber', 'red', 'blue', 'accent'];
  const rows = sortRows(ROWS, sort, (r, k) => r[k]);

  return (
    <PageContainer>
      <PageHeader title="Component kit" description="Visual QA for every shared component. Not linked from the navigation." />

      <Block title="Button">
        <div className="flex flex-wrap items-center gap-2">
          {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
            <Button key={v} variant={v} icon={<Play size={14} />}>{v}</Button>
          ))}
          <Button variant="primary" size="sm">Small</Button>
          <Button variant="secondary" size="sm" icon={<Plus size={14} />}>Small icon</Button>
          <Button variant="primary" loading>Loading</Button>
          <Button variant="secondary" disabled>Disabled</Button>
          <IconButton label="Delete" icon={<Trash2 size={16} />} shortcut="Del" />
          <IconButton label="Copy" variant="secondary" icon={<Copy size={16} />} />
          <IconButton label="Download" size="sm" icon={<Download size={14} />} />
          <SplitButton label="Run" icon={<Play size={14} />} onClick={() => toast.success('Load test started')} actions={[
            { key: 'load', label: 'Load test', shortcut: 'Ctrl+Enter', onSelect: () => toast('Load test') },
            { key: 'cap', label: 'Capacity test', onSelect: () => toast('Capacity test') },
            { key: 'cmp', label: 'Compare strategies', onSelect: () => toast('Compare strategies') },
          ]} />
          <SplitButton label="New project" variant="secondary" onClick={() => undefined} actions={[{ key: 'b', label: 'Blank', onSelect: () => undefined }, { key: 't', label: 'From template', onSelect: () => undefined }]} />
        </div>
      </Block>

      <Block title="Form controls">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <Field label="Input" hint="Sentence-case hint text">{(id) => <Input id={id} placeholder="Project name" />}</Field>
          <Field label="Input, invalid" error="Name is required">{(id) => <Input id={id} invalid defaultValue="" />}</Field>
          <Field label="Number field">{(id) => <NumberField id={id} value={n} onCommit={setN} min={1} max={500} unit="VUs" />}</Field>
          <Field label="Number field, decimals">{(id) => <NumberField id={id} value={2.5} onCommit={() => undefined} min={0} step={0.5} unit="ms" />}</Field>
          <Field label="Select">{(id) => <Select id={id} value={sel} onValueChange={setSel} options={['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'].map((v) => ({ value: v, label: v }))} />}</Field>
          <Field label="Slider">{() => <div className="flex items-center gap-3"><Slider aria-label="Workers" value={sl} onValueChange={setSl} min={1} max={64} /><span className="w-8 text-right font-mono text-xs tnum">{sl}</span></div>}</Field>
          <Field label="Switch">{(id) => <div className="flex items-center gap-2"><Switch id={id} checked={on} onCheckedChange={setOn} /><span className="text-xs text-muted">{on ? 'Cacheable' : 'Not cacheable'}</span></div>}</Field>
          <div>
            <FormRow label="Pool size">{(id) => <NumberField id={id} value={16} onCommit={() => undefined} min={1} max={250} />}</FormRow>
            <FormRow label="Retry backoff" hint="Per attempt">{(id) => <NumberField id={id} value={25} onCommit={() => undefined} unit="ms" />}</FormRow>
          </div>
        </div>
      </Block>

      <Block title="Pill, status dot, provenance, kbd">
        <div className="flex flex-wrap items-center gap-2">
          {tones.map((t) => <Pill key={t} tone={t}>{t}</Pill>)}
          {tones.map((t) => <Pill key={`m${t}`} tone={t} mono>812 tps</Pill>)}
          <Pill tone="amber">bottleneck</Pill>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          {(['ok', 'warn', 'bad', 'info', 'idle'] as const).map((s) => <span key={s} className="flex items-center gap-1.5"><StatusDot status={s} />{s}</span>)}
          <span className="flex items-center gap-1.5"><StatusDot status="info" pulse />running</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <ProvenanceTag kind="MEASURED" /><ProvenanceTag kind="EMULATED" /><ProvenanceTag kind="PROJECTED" />
          <span className="flex items-center gap-1 text-xs text-muted"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
          <Popover>
            <PopoverTrigger asChild><Button size="sm">How measurements work</Button></PopoverTrigger>
            <PopoverContent width={340}><HowMeasurementsWork /></PopoverContent>
          </Popover>
        </div>
      </Block>

      <Block title="Tabs">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="live">Live</TabsTrigger>
            <TabsTrigger value="txn" count={3}>Transactions</TabsTrigger>
            <TabsTrigger value="find" count={2}>Findings</TabsTrigger>
          </TabsList>
          <TabsContent value="live" className="pt-3 text-sm text-muted">Live charts go here.</TabsContent>
          <TabsContent value="txn" className="pt-3 text-sm text-muted">Per-transaction stats.</TabsContent>
          <TabsContent value="find" className="pt-3 text-sm text-muted">Advisor findings.</TabsContent>
        </Tabs>
      </Block>

      <Block title="Table (sortable, compact)">
        <div className="max-h-[220px]">
          <Table>
            <THead>
              <TR>
                <SortableTH label="Transaction" sortKey="name" sort={sort} onSort={setSort} />
                <SortableTH label="Count" sortKey="count" sort={sort} onSort={setSort} align="right" />
                <SortableTH label="p95" sortKey="p95" sort={sort} onSort={setSort} align="right" />
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.name} interactive>
                  <TD mono>{r.name}</TD>
                  <TD align="right" mono>{r.count.toLocaleString('en-US')}</TD>
                  <TD align="right" mono>{r.p95} ms</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </Block>

      <Block title="Overlays: tooltip, dropdown, dialog, overlay, toast">
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip content="Tooltip text" shortcut="Ctrl+Z"><Button>Hover me</Button></Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button>Menu</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem icon={<FileText size={14} />} onSelect={() => toast('Export DDL')}>Export DDL</DropdownMenuItem>
              <DropdownMenuItem icon={<Copy size={14} />} shortcut="Ctrl+D">Duplicate design</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Trash2 size={14} />} danger>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => setDlg(true)}>Open dialog</Button>
          <Button onClick={() => setOvl(true)}>Open full-screen overlay</Button>
          <Button onClick={() => toast.success('Saved', 'rev 7 pinned')}>Toast success</Button>
          <Button onClick={() => toast.error('Run failed', 'RUN_ACTIVE: another run holds the lock')}>Toast error</Button>
          <Button onClick={() => toast.info('Provisioning sandbox')}>Toast info</Button>
        </div>
        <Dialog open={dlg} onOpenChange={setDlg} title="Rename project" description="Names are shown in Projects and Runs." footer={<><Button onClick={() => setDlg(false)}>Cancel</Button><Button variant="primary" onClick={() => setDlg(false)}>Save</Button></>}>
          <Field label="Name">{(id) => <Input id={id} defaultValue="Course Registration Rush" />}</Field>
        </Dialog>
        <Overlay open={ovl} onClose={() => setOvl(false)} title="Schema designer" actions={<Button size="sm" icon={<Plus size={14} />}>Add table</Button>}>
          <div className="canvas-grid flex h-full items-center justify-center text-sm text-muted">Full-screen overlay body. Esc closes.</div>
        </Overlay>
      </Block>

      <Block title="Skeleton, empty state">
        <div className="mb-4 flex flex-col gap-2"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
        <EmptyState title="No runs yet" description="Run a load test from the Studio to see results here." actions={<><Button variant="primary">Open a project</Button><Button>Browse templates</Button></>} />
      </Block>

      <Block title="CodeBlock (SQL, copy + download)">
        <CodeBlock code={SQL} downloadName="schema.sql" lineNumbers />
      </Block>

      <div className="canvas-grid mb-6 flex h-24 items-center justify-center rounded-[10px] border border-line text-xs text-faint">canvas-grid helper</div>
    </PageContainer>
  );
}
