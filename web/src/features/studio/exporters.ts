import { getNodesBounds, getViewportForBounds, type ReactFlowInstance } from '@xyflow/react';
import { toPng } from 'html-to-image';
import { generateDdl, type DesignDoc } from '@datasim/shared';

export const fileSafe = (name: string) => (name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'design');

function saveAs(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}

export function exportDdl(projectName: string, design: DesignDoc): void {
  const { sql } = generateDdl(design.schema);
  const url = URL.createObjectURL(new Blob([sql], { type: 'text/plain' }));
  saveAs(url, `${fileSafe(projectName)}.sql`);
  URL.revokeObjectURL(url);
}

/** Renders the whole topology (not just the visible viewport) to a 2x PNG. */
export async function exportCanvasPng(rf: ReactFlowInstance, projectName: string): Promise<void> {
  const nodes = rf.getNodes();
  if (nodes.length === 0) throw new Error('The canvas is empty');
  const el = document.querySelector<HTMLElement>('.ds-canvas .react-flow__viewport');
  if (!el) throw new Error('Canvas is not mounted');
  const pad = 56;
  const b = getNodesBounds(nodes);
  const w = Math.ceil(b.width + pad * 2);
  const h = Math.ceil(b.height + pad * 2);
  const vp = getViewportForBounds(b, w, h, 1, 1, pad / Math.min(w, h));
  const url = await toPng(el, {
    width: w, height: h, pixelRatio: 2,
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    style: { width: `${w}px`, height: `${h}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
  });
  saveAs(url, `${fileSafe(projectName)}-topology.png`);
}
