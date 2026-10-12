import { Overlay } from '../../ui';
import type { EditorOverlayProps } from '../schema';

/** Replaced by the editors builder. */
export function WorkloadEditor({ open, onClose }: EditorOverlayProps) {
  return <Overlay open={open} onClose={onClose} title="Workload editor"><div className="p-6 text-muted">Workload editor</div></Overlay>;
}
