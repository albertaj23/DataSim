import { FileText } from 'lucide-react';
import { PageContainer, PageHeader } from '../shell/Page';
import { EmptyState } from '../ui';

export default function RunReportPage() {
  return (
    <PageContainer>
      <PageHeader title="Run report" />
      <EmptyState icon={<FileText size={20} />} title="Run report" description="Metrics, findings and invariants for a single run." />
    </PageContainer>
  );
}
