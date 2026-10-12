import { LayoutDashboard } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { EmptyState } from '../ui';

/** Full-bleed: no page padding. The Studio builder replaces this file. */
export default function StudioPage() {
  const { id } = useParams();
  return (
    <div className="canvas-grid flex h-full items-center justify-center">
      <EmptyState icon={<LayoutDashboard size={20} />} title="Studio" description={`Canvas for project ${id ?? ''}.`} className="bg-bg" />
    </div>
  );
}
