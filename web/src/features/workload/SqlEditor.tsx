// CodeMirror SQL editor with table/column completion (lang-sql schema), :param / :$bind.col completion and inline placeholder checks.
import { MySQL, sql } from '@codemirror/lang-sql';
import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, placeholder as cmPlaceholder, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useMemo, useRef, useState } from 'react';
import { sqlExtensions } from '../../ui/codemirror';
import { cn } from '../../ui';
import { placeholderCompletion, placeholderDiagnostics, scanPlaceholders, type PlaceholderScope } from './logic';

const placeholderTheme = EditorView.theme({
  '.ds-ph': { color: 'var(--info)' },
  '.ds-ph-bad': { color: 'var(--bad)', textDecoration: 'underline wavy var(--bad)', textUnderlineOffset: '3px' },
});

function placeholderMarks(scope: PlaceholderScope): Extension {
  const build = (text: string): DecorationSet => {
    const b = new RangeSetBuilder<Decoration>();
    const bad = new Map(placeholderDiagnostics(text, scope).map((d) => [d.from, d]));
    for (const h of scanPlaceholders(text)) {
      const d = bad.get(h.from);
      b.add(h.from, h.to, d ? Decoration.mark({ class: 'ds-ph-bad', attributes: { title: d.message } }) : Decoration.mark({ class: 'ds-ph' }));
    }
    return b.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = build(view.state.doc.toString()); }
      update(u: ViewUpdate) { if (u.docChanged) this.decorations = build(u.state.doc.toString()); }
    },
    { decorations: (v) => v.decorations },
  );
}

function placeholderSource(scope: PlaceholderScope) {
  return (ctx: { state: EditorState; pos: number }) => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const r = placeholderCompletion(line.text.slice(0, ctx.pos - line.from), scope);
    if (!r || r.options.length === 0) return null;
    return { from: line.from + r.from, options: r.options.map((o) => ({ label: o.label, detail: o.detail, type: 'variable', boost: 99 })), validFor: /^\$?\w*$/ };
  };
}

export interface SqlEditorProps {
  value: string;
  /** Called (debounced, and on blur) with the new text. Empty text is never committed. */
  onCommit: (v: string) => void;
  /** `{ table: [columns] }` for completion. */
  schema: Record<string, string[]>;
  /** Params and binds in scope; null disables placeholder support (invariants). */
  scope: PlaceholderScope | null;
  minHeight?: number;
  maxHeight?: number;
  ariaLabel?: string;
  className?: string;
  /** Empty text is valid and committed (import dialog); shows `placeholder` while empty. */
  allowEmpty?: boolean;
  placeholder?: string;
}

const DEBOUNCE_MS = 400;

export function SqlEditor({ value, onCommit, schema, scope, minHeight = 56, maxHeight = 360, ariaLabel, className, allowEmpty, placeholder }: SqlEditorProps) {
  const [text, setText] = useState(value);
  const textRef = useRef(value);
  const committed = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // External changes (undo / redo / another editor) replace the local text.
  useEffect(() => {
    if (value !== committed.current) { committed.current = value; textRef.current = value; setText(value); }
  }, [value]);

  const flush = () => {
    clearTimeout(timer.current);
    const v = textRef.current;
    if ((allowEmpty || v.trim() !== '') && v !== committed.current) { committed.current = v; commitRef.current(v); }
  };
  useEffect(() => flush, []); // eslint-disable-line react-hooks/exhaustive-deps

  const schemaKey = JSON.stringify(schema);
  const scopeKey = JSON.stringify(scope);
  const extensions = useMemo(() => {
    const ext: Extension[] = [
      // sqlExtensions = [plain sql(), highlight, theme]: keep highlight + theme, swap in a schema-aware sql().
      sql({ dialect: MySQL, upperCaseKeywords: true, schema }),
      ...sqlExtensions.slice(1),
      EditorView.lineWrapping,
      placeholderTheme,
    ];
    if (placeholder) ext.push(cmPlaceholder(placeholder));
    if (scope) {
      // One stable function: CodeMirror drops in-flight results when a source's identity changes between transactions.
      const source = placeholderSource(scope);
      ext.push(placeholderMarks(scope), EditorState.languageData.of(() => [{ autocomplete: source }]));
    }
    return ext;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaKey, scopeKey, placeholder]);

  const empty = !allowEmpty && text.trim() === '';
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-surface transition-colors focus-within:border-accent', empty ? 'border-bad' : 'border-line', className)} aria-label={ariaLabel}>
      <CodeMirror
        value={text}
        theme="none"
        extensions={extensions}
        minHeight={`${minHeight}px`}
        maxHeight={`${maxHeight}px`}
        onChange={(v) => {
          setText(v); textRef.current = v;
          clearTimeout(timer.current);
          timer.current = setTimeout(flush, DEBOUNCE_MS);
        }}
        onBlur={flush}
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, searchKeymap: false, autocompletion: true, bracketMatching: true, closeBrackets: true }}
      />
      {empty && <div className="border-t border-bad/40 px-3 py-1 text-xs text-bad">SQL is required (not applied)</div>}
    </div>
  );
}
