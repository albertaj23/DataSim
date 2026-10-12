// CodeMirror SQL editor for the console: schema-aware completion (tables, columns) and Mod-Enter to run. Lazy-loaded by QueryConsole.
import { MySQL, sql } from '@codemirror/lang-sql';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo, useRef } from 'react';
import { sqlExtensions } from '../../ui/codemirror';

export interface QueryEditorProps {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  /** `{ table: [columns] }` for completion. */
  schema: Record<string, string[]>;
}

export default function QueryEditor({ value, onChange, onRun, schema }: QueryEditorProps) {
  const run = useRef(onRun);
  run.current = onRun;
  const schemaKey = JSON.stringify(schema);
  const extensions = useMemo(() => [
    Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { run.current(); return true; } }])),
    // sqlExtensions = [plain sql(), highlight, theme]: keep highlight + theme, swap in a schema-aware sql().
    sql({ dialect: MySQL, upperCaseKeywords: true, schema }),
    ...sqlExtensions.slice(1),
    EditorView.lineWrapping,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [schemaKey]);
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme="none"
      extensions={extensions}
      minHeight="96px"
      maxHeight="220px"
      aria-label="SQL query"
      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, searchKeymap: false, autocompletion: true, bracketMatching: true, closeBrackets: true }}
    />
  );
}
