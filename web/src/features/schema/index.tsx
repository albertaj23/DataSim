import { Overlay } from '../../ui';

export interface EditorOverlayProps { open: boolean; onClose: () => void; /** Optional table to focus on open. */ focusTable?: string }

/** Replaced by the editors builder. */
export function SchemaDesigner({ open, onClose }: EditorOverlayProps) {
  return <Overlay open={open} onClose={onClose} title="Schema designer"><div className="p-6 text-muted">Schema designer</div></Overlay>;
}
