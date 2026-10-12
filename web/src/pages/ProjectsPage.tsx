import { Folder } from 'lucide-react';
import { PageContainer, PageHeader } from '../shell/Page';
import { EmptyState } from '../ui';

export default function ProjectsPage() {
  return (
    <PageContainer>
      <PageHeader title="Projects" />
      <EmptyState icon={<Folder size={20} />} title="Projects" description="Design a database topology, schema and workload, then run it against real MySQL." />
    </PageContainer>
  );
}
