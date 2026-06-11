# Parley design system

This document governs the interface. No component gets styled outside it: if
the system lacks something, extend this file first, then use the extension.

## Concept

Parley is an archive you can question. The visual identity comes from the
medium that idea already lives in: paper, ink, footnotes, marginalia, and one
highlighter. Chat is typeset like a manuscript in progress; the AI layer
annotates it the way a careful reader annotates a text: a rule in the margin,
a numbered footnote, a stroke of highlighter over the line that mattered.

The accent is highlighter ink. It is a wash applied over content at memory
moments. It is never paint on chrome: buttons, links, and navigation stay ink
on paper.

## Anti-default check

Known AI-generated looks, checked against and consciously diverged from:

1. Cream background, high-contrast serif body, terracotta accent. Diverged:
   the body face is Schibsted Grotesk, not a serif; the serif (Newsreader)
   appears only in five narrow display roles; the accent is a yellow
   highlighter wash over content, not a terracotta coat on buttons.
2. Near-black with a single acid-green or vermilion accent. Diverged: the ink
   theme is a warm umber black (#14130F), never blue-black, and its accent is
   muted gold (#E9C46A) applied as washes and thin rules, not glowing
   controls.
3. Broadsheet hairlines with zero radius everywhere. Diverged: hairlines
   carry structure but corners are softened (6px standard), avatars and pills
   are fully round, and exactly one shadow exists. The result reads as a
   notebook, not a newspaper.

Where this spec pins a value it is followed exactly. Open choices are
justified against the concept inline below.

## Typography

All Google Fonts, loaded with font-display swap.

| Role             | Face                          | Size and treatment                                                                                        |
| ---------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Messages, body   | Schibsted Grotesk 400         | 14px, line-height 1.55                                                                                    |
| UI labels, names | Schibsted Grotesk 400 and 600 | 13px                                                                                                      |
| Micro text       | Schibsted Grotesk 400         | 12px                                                                                                      |
| Display          | Newsreader 500, italic 400    | logotype, auth headline, empty-state headlines, the italic "Recall" label only. Never body, never buttons |
| Mono             | Spline Sans Mono 400 and 500  | timestamps, ids, keyboard hints; section eyebrows at 11px uppercase with 0.08em letter spacing            |

Tabular numerals (`font-variant-numeric: tabular-nums`) wherever numbers
align: unread counts, timestamps, stats. Timestamps always zero-padded.
At most two weights of the UI face per view: 400 and 600.

## Color

Paper is the default theme. Ink is one toggle away. Both are first class.

| Token                       | Paper               | Ink                    |
| --------------------------- | ------------------- | ---------------------- |
| ground                      | #F4F3EE             | #14130F                |
| panel (raised)              | #FBFAF7             | #1C1B16                |
| text                        | #1F1E1A             | #ECEAE2                |
| text-secondary              | #6B6960             | #A09D92                |
| hairline                    | rgba(31,30,26,0.12) | rgba(236,234,226,0.10) |
| wash (highlighter)          | #FFDF8E             | rgba(255,214,107,0.16) |
| accent ink (text on ground) | #7A5800             | #E9C46A                |
| success (desaturated green) | #3E6B43             | #93BC93                |
| danger (desaturated red)    | #9C3D33             | #DC9286                |

Semantic color choices justified against the concept: both are desaturated
toward the paper ground so they read as ink stamps, not status LEDs.

### Contrast pairs checked (AA, 4.5:1 minimum for text)

Measured with `node infra/contrast-check.mjs` (WCAG 2.1 relative luminance);
rerun it after any palette change:

| Pair                          | Paper  | Ink                             |
| ----------------------------- | ------ | ------------------------------- |
| text on ground                | 15.0:1 | 15.4:1                          |
| text on panel                 | 16.0:1 | 14.3:1                          |
| text-secondary on ground      | 5.0:1  | 6.8:1                           |
| text-secondary on panel       | 5.3:1  | 6.3:1                           |
| accent ink on ground          | 5.9:1  | 11.1:1                          |
| text on wash (citation chips) | 12.9:1 | 9.5:1 (wash blended over panel) |
| danger on ground              | 6.0:1  | 7.5:1                           |
| success on ground             | 5.6:1  | 8.7:1                           |

Non-text indicators (presence dots, hairlines) are exempt from the 4.5:1
text rule but stay above 3:1 against their grounds.

## Shape and depth

- Radius: 6px standard, 10px for overlays, full only on avatars and pills.
- Hairline 1px borders carry all structure.
- Exactly one shadow token, `--shadow-overlay`, used only on overlays:
  command palette, menus, toasts. Nothing inline ever casts a shadow.

## Motion

- Durations: 120ms (hover, fades), 180ms (panel transitions), 240ms (the
  signature sweep). One ease: cubic-bezier(0.2, 0, 0, 1).
- `prefers-reduced-motion`: every motion becomes a plain opacity change.

## The signature: the highlighter

All boldness is spent here; everything else stays quiet. The wash appears in
exactly five places and nowhere else:

1. Citation chips on AI answers.
2. The citation jump: after scrolling to a source message, a wash sweeps
   across the row left to right in 240ms, fades over 1.4s, and a hairline
   accent left rule persists for 3s.
3. Unread count chips in the sidebar.
4. Text selection, via ::selection.
5. The Catch me up pill.

Anything else that seems to want the wash gets a hairline or weight instead.

## Surface specifications

- Sidebar: 264px wide, 32px rows, room name with presence dot, unread count
  in tabular mono on a wash chip, section eyebrows in mono caps, current user
  footer with theme toggle. Active room is marked by 600 weight and a panel
  tint, never the wash.
- Message list: flat, left-aligned editorial rows. No bubbles, no
  left-right alternation. Group header carries sender name (600) and mono
  time; messages from the same sender within 3 minutes group beneath it.
  Hover reveals the timestamp gutter and a faint row wash
  (rgba of text at 3 percent, not the highlighter). Day separators are a
  hairline with a centered mono date label.
- AI answers are marginalia, not robot cards: a 2px accent left rule, the
  word Recall in Newsreader italic with the asker's question in secondary
  text, body set as normal text, citations as superscript-style numbered
  chips carrying the wash, and a Sources expander that renders like endnotes
  with mono timestamps. While streaming, the row reserves vertical space and
  shows a quiet caret; layout never reflows as tokens arrive.
- Composer: quiet until focused. A hairline top border, no boxed card.
  Textarea autogrows to six lines. Keyboard hints in mono fade out while
  typing. Send is an ink-primary button (ink on paper, paper on ink).
- Command palette: top third of the viewport, 560px wide, hairline border,
  the single overlay shadow, mono section eyebrows, 36px result rows,
  shortcut hints right-aligned in mono.
- Empty and error states: a short Newsreader headline, one sentence of
  direction. AI surfaces add three suggestion chips guaranteed to work
  against seed data. Errors state what happened and what to do next. Never
  apologize, never vague.
- Auth: centered card on the paper ground, logotype in Newsreader, one line
  of product truth beneath it, inline validation, loading states on buttons.
- README banner: a typographic SVG, logotype in Newsreader with one
  highlight sweep behind the word.

## Microcopy voice

Sentence case. Plain verbs. Terse. No exclamation marks. No em dashes
anywhere; use commas, colons, or periods. Buttons say exactly what happens:
"Save changes", not "Submit". An action keeps its name through its whole
flow. Errors: what happened, then what to do. Examples used in the app:

- "No messages yet. Say the first word."
- "Recall could not finish this answer. Ask again"
- "Daily Recall budget used. It resets at midnight UTC"
- "Joining rooms too quickly. Try again in 5s"
- Buttons: "Sign in", "Create account", "Send", "Catch me up",
  "Extract decisions", "Regenerate", "Continue in room".

## Critique pass record (2026-06-11)

Captured live: room view with a streamed Recall answer (paper and ink), the
citation jump, and the auth screen (paper and ink), at 1280px and mobile
width. Lighthouse accessibility after the pass: auth 100, chat 100
(`node infra/lighthouse-audit.mjs`). Found and changed:

1. The citation jump initially landed on the wrong message: the @recall
   command itself was ingested seconds before the answer ran and won
   retrieval for its own question. Fixed in three layers: recall commands
   are never enqueued, never embedded by the worker, and filtered out of
   fused retrieval results. A question is not a source.
2. Messages created before the kind field existed were invisible to both the
   backfill and the lexical leg ({ kind: 'user' } does not match missing
   fields). Switched to { kind: { $ne: 'ai' } } on both paths and re-ran the
   backfill; all legacy messages became retrievable.
3. The new-messages pill was specified with the wash in an early draft; that
   would have been a sixth wash site. It ships as an ink-primary pill, and
   the wash count stays at five.
4. Mechanical checks: no Inter (only setInterval matches), no default
   blue/indigo/violet/purple utilities, no rounded-2xl, no shadows beyond
   the overlay token, icons via lucide-react only (the Avatar SVG is content,
   an identicon, not an icon). The single linear-gradient in CSS paints the
   sweep with two identical stops: a moving solid, not a visual gradient.
5. Computed-style verification in ink theme: ground rgb(20,19,15), panel
   rgb(28,27,22), text rgb(236,234,226), accent rule rgb(233,196,106),
   matching the token table exactly.
6. The command palette did not exist at the time of this pass (it is a
   Phase 10 surface); its capture and critique are appended after Phase 10.

## Craft checklist (enforced at the design gate)

- No Tailwind default blue, indigo, or violet anywhere.
- No gradients, no glassmorphism, no emoji as decoration.
- No rounded-2xl-everything, no chat bubbles, no Inter.
- Icons: Lucide only, 16px, 1.5 stroke, optically aligned.
- Focus rings visible on every interactive element (accent ink, 2px).
- AA contrast verified (table above).
- No layout shift on message arrival or while streaming.
- Both themes complete; paper is the default.
