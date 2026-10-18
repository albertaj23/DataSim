import { sql, MySQL } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/** Editor chrome driven by the CSS tokens, so it follows the light/dark theme. */
export const dsEditorTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--fg)', fontSize: '12px' },
  '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--accent)', padding: '8px 0' },
  '.cm-line': { padding: '0 12px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)',
  },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--faint)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-tooltip': { backgroundColor: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--fg)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--surface-3)', color: 'var(--fg)' },
});

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--accent)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--ok)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--warn)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--faint)', fontStyle: 'italic' },
  { tag: [t.typeName, t.standard(t.name)], color: 'var(--info)' },
  { tag: [t.operator, t.punctuation, t.separator], color: 'var(--muted)' },
  { tag: [t.special(t.name), t.labelName], color: 'var(--info)' },
]);

/** SQL (MySQL dialect) syntax + theme. Add `EditorView.editable.of(false)` for read-only. */
export const sqlExtensions: Extension[] = [sql({ dialect: MySQL, upperCaseKeywords: true }), syntaxHighlighting(highlight), dsEditorTheme];
