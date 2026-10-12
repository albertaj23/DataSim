import { GitCompare } from 'lucide-react';
import { PageContainer, PageHeader } from '../shell/Page';
import { EmptyState } from '../ui';

export default function ComparePage() {
  return (
    <PageContainer>
      <PageHeader title="Compare" />
      <EmptyState icon={<GitCompare size={20} />} title="Compare" description="Side-by-side metrics and design diff for selected runs." />
    </PageContainer>
  );
}
