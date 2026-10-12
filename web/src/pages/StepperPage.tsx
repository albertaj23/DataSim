import { ListOrdered } from 'lucide-react';
import { PageContainer, PageHeader } from '../shell/Page';
import { EmptyState } from '../ui';

export default function StepperPage() {
  return (
    <PageContainer>
      <PageHeader title="Transaction Stepper" />
      <EmptyState icon={<ListOrdered size={20} />} title="Transaction Stepper" description="Step two transactions statement by statement and watch InnoDB locks." />
    </PageContainer>
  );
}
