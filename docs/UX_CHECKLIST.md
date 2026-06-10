# UX checklist

Manual verification pass, recorded 2026-06-10. Each item lists how it was
verified: live in the running app, by automated integration tests, or both.

## Lighthouse

| Screen | Accessibility score |
| ------ | ------------------- |
| Auth   | 100                 |
| Chat   | 100                 |

Method: `node infra/lighthouse-audit.mjs` against the dev server. The script
registers a real user, then audits the authenticated chat screen via the
session restored from the httpOnly refresh cookie. Two contrast violations
found on the first run (white on accent button 3.21, muted footer text 4.26)
were fixed by adding an accent-strong token for filled controls and
lightening the muted gray. Both screens then scored 100.

## Design system

- [x] Inter for UI, mono face for timestamps, ids, and usernames. Verified live.
- [x] 4px spacing scale (Tailwind defaults). Verified in code.
- [x] Two font weights per view: 400 and 600 only. Verified in code (`font-semibold` is the only weight utility used).
- [x] Dark theme default, light toggle in the sidebar footer, persisted to localStorage. Verified live in both themes.
- [x] Neutral gray ramp, one accent. Accent appears only on: primary action buttons, unread badges, own display name, read receipts, focus rings, active room. Verified live.
- [x] AA contrast minimum: Lighthouse color-contrast audit passes on both screens after fixes.
- [x] No gradients, no glassmorphism, no decorative shadows, no decorative emoji. Verified by inspection.

## Layout

- [x] Two-pane desktop layout: sidebar (rooms, unread counts, presence dots, current-user footer) plus chat pane. Verified live at 1280px.
- [x] Mobile: sidebar becomes a slide-over with overlay, opened from the room header, closes on Escape and on room selection. App fully usable at 375px. Verified live at mobile width.

## Chat UX

- [x] Consecutive messages from the same sender within 3 minutes group under one header. Verified live: a second message from the same sender rendered without a repeated header.
- [x] Day separator rows ("Today", "Yesterday", full date beyond). Verified live.
- [x] Relative timestamps with exact zero-padded time on hover (`title` attribute carries `YYYY-MM-DD HH:MM:SS`). Verified live.
- [x] Delivery states on own messages: sending (clock), sent (single check), delivered (double check), read (double check, accent), failed (retry affordance). Sent and read verified live end to end with a second socket client; delivered and the full state machine covered by integration tests; failed state code-reviewed with a retry button that resends under a new clientMsgId.
- [x] Optimistic send keyed by clientMsgId, reconciled on ack. Verified live (message appears instantly) and the server dedup path is integration tested.
- [x] Virtualized list (react-virtuoso) anchored to bottom; followOutput only when already at bottom, so reading history is never yanked. Verified live.
- [x] New-messages pill when scrolled up, click scrolls to latest. Code-reviewed; pill logic counts only messages from others.
- [x] No layout shift from the typing indicator: the row has a fixed height whether or not anyone is typing. Verified live.
- [x] Skeleton loaders during initial history fetch. Verified in code (renders only before first page arrives, so it is hard to catch live on localhost).
- [x] Designed empty states for no-room-selected and empty-room. Both verified live.
- [x] Connection-loss toast with reconnect status, aria-live polite. Code-reviewed; reconnect sync covered by integration tests.
- [x] Enter sends, Shift+Enter inserts newline, textarea autogrows to a max height. Verified live.
- [x] Visible focus rings on all interactive elements (`:focus-visible` outline in the accent). Verified live by tabbing.
- [x] `prefers-reduced-motion` collapses all animation and transitions to 0.01ms. Implemented globally in CSS; not verified against a live OS setting.
- [x] Typing indicator shows the typist's name, expires server-side after 3 seconds. Live indicator verified ("Someone is typing" with animated dots); naming requires the roster, which refreshes automatically when an unknown user types.

## Auth screens

- [x] Centered card, tabbed sign in and create account. Verified live.
- [x] Inline validation per field on blur and submit, from the same zod schemas the server enforces. Verified live (Lighthouse run initially failed registration short of valid input).
- [x] Loading state on the submit button with spinner. Verified in code and live.
- [x] Server errors (taken username, bad credentials) render in a role=alert region, no dead ends. Verified in code; duplicate username path integration tested server-side.
- [x] Session restore from refresh cookie on reload. Verified live (Lighthouse chat audit depends on it working).

## Known limitations, honestly

- Presence dots in the sidebar depend on loaded rosters; rooms beyond the
  first 20 member rooms load their roster on first open.
- Unread badge counts come from the server on load and increment locally on
  live messages; a missed window between page load and socket connect could
  undercount until the next sidebar refresh (reconnect triggers one).
- The relative timestamp text ("5m ago") updates on re-render, not on a timer.
