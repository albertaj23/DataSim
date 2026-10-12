import { FlaskConical } from 'lucide-react';
import { PageContainer, PageHeader } from '../shell/Page';
import { EmptyState } from '../ui';

export default function LabPage() {
  return (
    <PageContainer>
      <PageHeader title="Concurrency Lab" />
      <EmptyState icon={<FlaskConical size={20} />} title="Concurrency Lab" description="Benchmark the eight concurrency-control strategies on real transactions." />
    </PageContainer>
  );
}
