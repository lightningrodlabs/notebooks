# Comments on notes — design

Google-Docs-style commenting on notebook text, in both the rich-text (wysiwyg)
and the markdown editor, reusing the annotation machinery built for the
OWW workshop tool (`~/code/oww/oww-moss`).

## 1. Goal

A participant selects a span of text, attaches a comment, and every other
participant sees the highlight and the margin card in real time. Comments have
replies, can be resolved and reopened, and survive concurrent editing by other
people, including comments from different people on overlapping ranges. The
note's storage stays markdown; comments are not written into the text.

## 2. Decisions

| Topic | Decision |
|---|---|
| Where comments live | In the note's Syn/Automerge document, beside the text. No DNA change. |
| Anchoring | Automerge **Text marks** named `comment:<id>` on the body. The CRDT keeps them correct under concurrent edits; overlapping marks with different names coexist. |
| Storage shape of the text | Migrate from `text: string[]` (list of characters) to `body: Text`. Marks and cursors only exist on Text. |
| Ephemeral cursors | Automerge cursors (`getCursor`/`getCursorPosition`) replace list element ids. |
| Overlap | Independent comments, never merged. Highlight depth is drawn by splitting ranges into non-overlapping segments. The workshop's merge-on-overlap is a single-reviewer legacy rule and is not ported. |
| Orphans | A comment whose whole range was deleted keeps its record and stored quote and shows as detached in the margin. |
| Markdown purity | Text stays pure markdown. Export carries comments in the JSON export losslessly and as CriticMarkup (`{==text==}{>>comment<<}`) in a markdown copy. CriticMarkup is an export format only. |
| Reuse from OWW | `fitCards` layout (verbatim), quote selector scoring (adapted to plain strings), highlight-as-decoration approach, margin card behaviour (blank card deletes itself on blur). |

## 3. Data model (`ui/src/grammar.ts`)

```ts
type TextEditorState = {
  body?: string;                       // Automerge Text; the markdown
  text?: string[];                     // legacy list of chars; absent once migrated
  comments?: Record<string, Comment>;  // keyed by id
};
interface Comment {
  id: string;            // crypto.randomUUID()
  author: AgentPubKeyB64;
  created: number;       // ms epoch
  text: string;
  quote: string;         // the selected text at creation, for orphans and search
  resolved: boolean;
  replies: Reply[];
}
interface Reply { id: string; author: AgentPubKeyB64; created: number; text: string }
type TextEditorEphemeralState = { [agentB64: string]: { cursor: Cursor; characterCount: number } };
```

The range of a comment is the mark `comment:<id>` with value `true` and
`expand: 'none'` (typing inside the range extends it, typing at either edge
does not, matching Google Docs). The range is never stored in the `Comment`
record; it is read from `Automerge.marks(doc, ['body'])`.

Grammar operations (all run inside `slice.change`):

- text: `insert(from, text)`, `delete(from, count)` via `Automerge.splice`;
  `changeSelection(from, count)` stores a cursor.
- comments: `addComment({ id, from, to, text })` (mark + record, quote taken
  from the body), `setCommentText(id, text)`, `setResolved(id, bool)`,
  `deleteComment(id)` (unmark + delete record), `addReply(id, reply)`,
  `setReplyText(id, replyId, text)`, `deleteReply(id, replyId)`.

Authorisation is UI-side only (same trust level as the text itself): the
margin offers edit/delete only to the author.

## 4. Migration

`ui/src/text.ts` provides `textOf(state)` (reads `body`, else joins `text`),
`isMigrated(state)` and `migrateText(state)` (inside a change: `body =
text.join('')`, `delete text`). Read-only consumers (rendered note, note list,
diff viewer, export) use `textOf`, because old commits stay in history
forever. The note shells (`markdown-note`, `richtext-note`) run the migration
once when the session store is ready and `body` is absent, before an editor
mounts, so editors only ever see `body`. `createNote` writes `body` directly.

Race: two peers joining an unmigrated note at the same moment both write
`body`; Automerge keeps one by last-writer-wins. Both contain identical text,
so at most a few keystrokes typed into the losing copy during that second are
lost. Accepted.

## 5. Anchoring and resolution (`ui/src/comments/`)

- `ranges.ts`: `commentRanges(doc): CommentRange[]` from marks
  (`{ id, start, end }` in markdown offsets); `segments(ranges)` splits
  overlapping ranges into non-overlapping `{ start, end, ids }` pieces for
  depth rendering. Pure.
- `selector.ts`: quote re-anchoring over a plain string (port of the OWW
  scorer): `findQuote(text, { exact, prefix, suffix, start })`. Used only for
  the rendered markdown preview, where syntax characters are gone.
- `layout.ts`: `fitCards` from OWW, verbatim.
- `criticmarkup.ts`: `toCriticMarkup(body, comments, ranges)`.
- `model.ts`: the pure derivation `commentsView(doc, showResolved)` →
  comments with their range (or `null` for orphans), ordered by position.

## 6. Rendering

**Rich text (`syn-pm-editor`).** A ProseMirror plugin holds `{ segments,
activeId }` and builds inline decorations with class `nb-comment nb-depth-N`
(+ `nb-comment-active`) and `data-comment-ids`. Markdown offsets map to
ProseMirror positions through the editor's existing `markdownPosToProseMirrorPos`
after refreshing the maps with `docToText`. Decorations are rebuilt on every
`docState` update and on activation change. Clicking a highlight activates
the first comment at that position. Anchor top per comment =
`view.coordsAtPos(from).top` relative to the editor row.

**Markdown (`syn-md-editor`).** CodeMirror `markText` per segment with the
same classes, cleared and re-applied on every state update. Anchor top =
`editor.charCoords(posFromIndex(start), 'local').top`. Selection comes from
`indexFromPos` on the current selection.

**Rendered preview (`markdown-note` Both/View, `rendered-note`).** Best
effort: each comment's quote is stripped of inline markdown syntax, located in
the rendered container's text with `findQuote`, mapped to a DOM `Range` by
walking text nodes, and painted with the CSS Custom Highlight API
(`CSS.highlights`), which supports overlapping ranges without touching the
DOM. No margin in the preview; highlights only.

**Overlap depth CSS.** `nb-depth-1..3+` use the same hue with increasing
alpha; `nb-comment-active` adds a solid outline. Theme-aware via Shoelace
tokens.

## 7. Margin UI (`<comment-margin>`)

A 280px column rendered by the editor element itself, to the right of the
text, so it scrolls with the text. Cards are absolutely positioned at
`fitCards` tops. Each card: author (profile nickname + avatar), time, quote
(italic, truncated, click scrolls/activates), body (textarea for the author,
text for others), replies with a reply box, Resolve/Reopen, Delete (author
only). Orphans show "original text was deleted". A header shows "N comments",
a show-resolved toggle and a "Copy as markdown" (CriticMarkup) button.

Creating a comment: when the editor has a non-empty selection a small
floating "+ Comment" button appears beside it; clicking creates a comment with
empty text and focuses its card. A card that loses focus while still blank
deletes its comment (OWW behaviour). Each editor exposes
`commentSelection(): { from, to } | null` in markdown offsets.

Events from the margin: `comment-activate`, `comment-change`,
`comment-delete`, `comment-resolve`, `comment-reply`, `reply-change`,
`reply-delete`. The editor forwards them to the grammar through the slice.

## 8. Shared controller (`ui/src/comments/controller.ts`)

A Lit `ReactiveController` used by both editors: holds `activeId`,
`showResolved`, the derived view from `docState`, the anchor-top map, and the
mutation methods that call the grammar. The editor supplies
`anchorTop(offset)`, `paint(segments, activeId)` and `selection()`.

## 9. Export / import

`NoteWorkspace` gains `comments?: ExportedComment[]` (`{ id, author,
created, text, quote, resolved, replies, start, end }`; `start/end` omitted
for orphans). Export reads marks from the latest snapshot. Import recreates
records and marks through `createNote`'s initial state. The JSON export
version stays `"1"`: readers without comment support ignore the field.

## 10. Testing

Vitest at the repo root (node environment, Automerge loads natively), tests
beside the modules they cover:

- grammar: insert/delete/selection on Text; every comment op; concurrent
  merges (prefix insert + partial delete + second overlapping comment;
  concurrent replies); orphan on full deletion; migration of a legacy doc.
- `ranges`/`segments`: overlap splitting, depth, ordering.
- `selector`: quote scoring on plain strings (ported cases).
- `layout`: `fitCards` (ported cases).
- `criticmarkup`: nested/overlapping ranges are split, orphans appended as
  trailing comments.
- `text`: `textOf` on both shapes.

Lit elements are verified by `npm run build -w ui` (type check + lint) and a
manual two-agent run with `npm run start:moss`.

## 11. Phases

1. Text migration + cursors + vitest harness (no visible change).
2. Comment grammar, pure modules, controller, margin element; wired into the
   rich-text editor.
3. Markdown editor highlights + margin; rendered preview highlights.
4. Export/import, CriticMarkup copy.

## 12. Risks

- The rich-text editor replaces its whole ProseMirror doc on every remote
  change; decorations are rebuilt from state after each replacement, so this
  costs one marks read per update. Fine for note sizes.
- Position maps only cover text characters; a selection edge on a syntax
  character snaps to the nearest mapped character (existing fallback).
- Rendered-preview highlighting is approximate when the quote contains
  inline syntax; it degrades to no highlight, never a wrong one, because the
  scorer requires an exact match of the stripped quote.
