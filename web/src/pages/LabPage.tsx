import { useSearchParams } from 'react-router-dom';
import { PageContainer, PageHeader } from '../shell/Page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui';
import { History } from '../features/lab/History';
import { IndexExperiment } from '../features/lab/IndexExperiment';
import { StrategyBenchmark } from '../features/lab/StrategyBenchmark';
import { LegacyNames } from '../features/lab/widgets';

const TABS = ['strategy', 'index', 'history'] as const;
type TabKey = (typeof TABS)[number];

/** Concurrency Lab (Review 1): the eight concurrency-control strategies on real transactions, plus the index experiment and saved history. */
export default function LabPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TabKey = (TABS as readonly string[]).includes(raw ?? '') ? (raw as TabKey) : 'strategy';
  const setTab = (t: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });

  return (
    <PageContainer>
      <PageHeader
        title="Concurrency Lab"
        description="Race real transactions against MySQL 8.4 / InnoDB and see which concurrency-control strategy keeps the invariant."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="strategy">Strategy benchmark</TabsTrigger>
          <TabsTrigger value="index">Index experiment</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        {/* forceMount keeps results and running experiments alive while another tab is open. */}
        <TabsContent value="strategy" forceMount className="data-[state=inactive]:hidden"><StrategyBenchmark /></TabsContent>
        <TabsContent value="index" forceMount className="data-[state=inactive]:hidden"><IndexExperiment /></TabsContent>
        <TabsContent value="history" className="data-[state=inactive]:hidden">{tab === 'history' && <History />}</TabsContent>
      </Tabs>
      <LegacyNames className="mt-6 border-t border-line pt-3" />
    </PageContainer>
  );
}
