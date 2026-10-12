import { Activity } from 'lucide-react';
import { PageContainer, PageHeader } from '../shell/Page';
import { EmptyState } from '../ui';

export default function RunsPage() {
  return (
    <PageContainer>
      <PageHeader title="Runs" />
      <EmptyState icon={<Activity size={20} />} title="Runs" description="Every load and capacity run, with verdicts. Select two to four to compare." />
    </PageContainer>
  );
}
