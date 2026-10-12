import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { Check, Copy, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { IconButton } from './Button';
import { cn } from './cn';
import { sqlExtensions } from './codemirror';

export interface CodeBlockProps {
  code: string;
  /** Shows a download button saving `code` under this name (e.g. "schema.sql"). */
  downloadName?: string;
  /** Max height in px before scrolling. */
  maxHeight?: number;
  lineNumbers?: boolean;
  className?: string;
}

/** Read-only SQL block with copy and optional download. */
export default function CodeBlockEditor({ code, downloadName, maxHeight = 420, lineNumbers = false, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const extensions = useMemo(() => [...sqlExtensions, EditorView.editable.of(false), EditorView.lineWrapping], []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = downloadName ?? 'code.sql'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-line bg-surface', className)}>
      <div className="absolute right-1.5 top-1.5 z-[2] flex gap-0.5 rounded-md bg-surface/90">
        <IconButton size="sm" label={copied ? 'Copied' : 'Copy'} icon={copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />} onClick={copy} />
        {downloadName && <IconButton size="sm" label={`Download ${downloadName}`} icon={<Download size={14} />} onClick={download} />}
      </div>
      <CodeMirror
        value={code}
        theme="none"
        extensions={extensions}
        editable={false}
        readOnly
        maxHeight={`${maxHeight}px`}
        basicSetup={{ lineNumbers, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false, searchKeymap: false }}
      />
    </div>
  );
}
