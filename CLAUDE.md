# Invoice Review Prototype — project context for Claude Code

This is a **static HTML/CSS/JS prototype** (no build step, no framework, no
dependencies — open `index.html` directly or serve the folder with any
static file server). It mocks the invoice-processing UI for Nomni Procure's
Invoice Agent: upload → 3-way match against a PO/GRN → auto-post clean
matches → route exceptions to a human. It is a design/product prototype for
gathering feedback, not production code — favor readability and fast
iteration over architectural rigor when editing it.

## Who this is for and why it exists

Built for a PM at Zeemart/Liven working on Nomni Procure, to socialize a
proposed redesign of invoice capture, exception review, and status with
stakeholders before any real engineering work starts — it's a conversation
piece for design review, not a spec to build directly against. It stands in
front of the current (worse) invoice-review experience and argues for a
specific set of changes: clearer exception reasons than a generic "needs
review," a completeness checklist instead of a single pass/fail, and a
matching-policy control that's visible rather than buried in a config file
nobody remembers exists. Expect this repo to keep evolving through several
more rounds of "change X, add Y" as more stakeholders see it — treat new
requests the way you'd treat product feedback, not bug reports.

## Product context: the real Invoice Agent this mocks

Nomni Procure's Invoice Agent is a real (separately specified and
implemented) AI agent that ingests invoices from photo/PDF/email/PEPPOL,
matches them against POs and GRNs, auto-posts clean matches, and routes
exceptions to a human — pitched as the highest-value automation in Nomni
Procure for finance teams, and a differentiator against competitors who
lack Nomni's PEPPOL e-invoicing support. This prototype is a UI mock of
that agent's workflow, not the agent itself, and simplifies or diverges
from the real spec in a few deliberate ways worth knowing about before
"fixing" something that looks like a bug:

- **The real product's default tolerances**: price variance ±2%, quantity
  variance ±1%, extraction confidence < 0.85 forces human review, and
  duplicate = same supplier + invoice number + amount. This prototype's
  mock data doesn't compute against live tolerances — statuses are
  hand-seeded per invoice in `data.js` to demonstrate each scenario clearly,
  not derived from a tolerance engine.
- **"No auto-post without GRN" is a real non-negotiable in the actual
  agent** — the 2-way match mode in this prototype (see `MATCH_MODE` in
  `app.js`) is a deliberate, explicit UI exploration of *relaxing* that
  rule for suppliers who never generate a GRN (services, subscriptions),
  not an oversight. If asked to change matching-mode behavior, preserve the
  framing that 2-way is a lower-control tradeoff being surfaced
  transparently (see the warning copy in the Matching settings modal), not
  a silent default.
- **PEPPOL invoices are never OCR'd** in the real agent (structured XML
  parse only) — this prototype's `source: 'peppol'` invoices are just
  tagged as such for the badge/UI treatment; there's no real parsing logic
  to preserve either way.
- **Every auto-posted invoice gets an undo window and an audit trail** in
  the real agent. This prototype has an `auditTrail[]` field and an edit-
  history popover for line edits, but no undo affordance yet — a plausible
  next feature request, not a gap to silently fill in.
- Real accounting sync targets are Xero (primary), QuickBooks Online, and
  MYOB — this prototype hardcodes Xero via `ACCOUNTING_SYSTEM` in `app.js`.

## Files

- `index.html` — markup only (sidebar nav, tabs, tables, modals, the
  invoice detail screen). No inline styles or scripts beyond a couple of
  `onclick=` handlers matching the rest of the codebase's style.
- `styles.css` — all styling. CSS custom properties at the top of the file
  (`--seaweed`, `--fern`, `--spring`, `--rose`, `--sun`, `--sky`, etc.) define
  the whole palette — reuse these tokens rather than hardcoding colors.
- `data.js` — the two mock datasets, loaded before `app.js`:
  - `INV`: every seeded invoice shown across Uploads / Needs your input /
    Processed. Add or edit entries here to try new scenarios.
  - `PO_CATALOG`: the open POs available to link an unmatched invoice
    against (what the "Link PO" type-ahead searches).
- `app.js` — all application logic: status computation, table rendering,
  the invoice detail screen, modals, popovers.

Because `data.js` loads before `app.js` as a separate `<script>` tag, `INV`
and `PO_CATALOG` are ordinary top-level `const` bindings shared across both
scripts (classic scripts on one page share a lexical scope) — no import
system, no `window.` assignment needed.

## Data model (`data.js`)

Each invoice in `INV` has: `id`, `po` (nullable), `poDate`, `supplier`
(nullable — null means not yet identified), `outlet`, `date`, `source`
(`'email' | 'upload' | 'photo' | 'peppol'`), `amount`, `status`, `by`
(uploader/actor name), `lines[]`, `capturedLines[]`, `matchAttempted`,
`legible`, `duplicateOf`, `reasonTag`, `why`, `viewed`, `freshCapture`,
`exportedTo`, `margin`, `auditTrail[]`.

**`status`** is one of: `pending` (Uploads tab — still being identified/
matched, or awaiting GRN), `risk` / `warn` (Needs your input tab —
`risk` = blocking issue needing a decision, `warn` = lower-severity, has a
default resolution action), `ok` (Processed, auto-matched cleanly, one
click from being approved), `approved` (Processed, resolved by a human —
via clean-match approval or exception resolution — one click from export),
`exported` (Processed, synced to the accounting system, read-only).

**`lines[]` vs `capturedLines[]`** — these are deliberately different:
`lines` is the PO-matching working set (used by `computeOutcome()`,
`build3WayMatch()`, the line-items table) and only has entries once a PO is
linked. `capturedLines` is what OCR/the source document actually shows
(used by `buildDocMockup()` to render the "Source document" preview) and
exists independent of PO matching. Don't conflate them — a line that's
`missing` (never invoiced) should appear in `lines` but NOT in
`capturedLines`, and vice versa for `extra`/`unmapped` lines.

**Per-line flags** (on entries in `lines[]`): `l.extra` = invoiced but not
on the PO (supplier added it outside the system); `l.missing` = on the PO
but never invoiced (placeholder line, no real `invPrice`/`grn`, excluded
from total reconciliation); `l.unmapped` = doesn't match any known
market-list item. All three carry `grn: null` explicitly (never
`undefined` — code elsewhere filters on `l.grn !== null` to mean "received"
and `undefined !== null` would silently miscount).

**`reasonTag`** values and what they mean: `'Price'`, `'Quantity'`, `'Total
mismatch'` are financial variances (dollar amounts can be computed against
them — see `exceptionCaughtAmount()` in `app.js`). `'Extra items'`,
`'Items missing'`, `'Unmapped item'`, `'Items differ from PO'` are
item-set/composition problems (checked *before* the financial checks in
`computeOutcome()`, since they make a line-by-line price/qty comparison
meaningless). `'No PO linked'`, `'Unreadable'`, `'Duplicate'` are `pending`-
status blockers, not exceptions.

## Status pipeline (`app.js`) — single source of truth

`computeOutcome(inv)` is the one function that decides an invoice's status
and reasonTag from its data. `recomputeAllStatuses()` runs it over every
invoice (skipping `approved`/`exported` — those are final) and
`refreshAllTables()` calls that plus re-renders every table, the stats row,
and the tab counts. **Any change that could affect status/matching (editing
a line, linking a PO, toggling matching mode) should go through
`refreshAllTables()`, never patch a table's HTML directly.**

`runChecks(inv)` produces the ordered checklist shown in the completeness
popover (`pending` / `pass` / `fail` / `wait` / `na` per checkpoint) — kept
in sync with `computeOutcome()`'s logic but is a separate function since it
needs to explain *why*, not just decide the outcome.

`blockingReason(inv)` and `statusPillHtml(inv)` turn a reasonTag into the
plain-language text shown in the "What's blocking" column and the detail
page's status pill — extend these (not a generic per-status string) when
adding a new reasonTag, or you'll get a misleading pill like "Quantity
above GRN" on an invoice that's actually missing an item.

## Matching mode (2-way vs 3-way)

`MATCH_MODE` (`'3way'` default, or `'2way'`) is a global config flag, set
via the "⚙ Matching" button/modal in the top bar — an org-wide policy
switch, not a per-invoice toggle. `2way` mode drops the GRN/goods-receipt
leg entirely: `computeOutcome()`, `runChecks()`, `build3WayMatch()`, and the
per-line status rendering in `openDetail()` all branch on it. Flipping it
calls `refreshAllTables()` so every non-finalized invoice is re-evaluated
immediately (see `saveMatchSettings()`). If you add a new check that reads
GRN data, gate it on `MATCH_MODE` the same way.

## UI patterns worth knowing before editing

- **Floating popovers** (`#cstat-popover`, `#history-popover`, PO
  type-ahead): one shared DOM element per popover type, positioned via
  `getBoundingClientRect()` from whichever button opened it, not one
  element per row — so opening one never reflows the table. Dismissed via
  outside-click and a capture-phase scroll listener; if you add a new
  popover, follow this pattern rather than a per-row element.
- **List filter/sort**: `LIST_CTL` (per-tab query/outlet/sort/reason state)
  + `applyListCtl()` is the shared pipeline for Uploads/Needs/Processed —
  route new filter UI through this rather than ad hoc filtering.
- **Detail screen pager**: `getTabList()` / `renderDetailPager()` /
  `navigateDetail()` — Left/Right arrow keys and the `‹ N of M ›` control
  page through whichever tab's *currently filtered/sorted* list the detail
  view was opened from (`window._detailFrom`), not the full invoice array.
- Currency formatting always goes through `fmt()` (`S$` + AU locale
  formatting) — don't hand-format amounts elsewhere.

## Non-goals

This prototype doesn't call any real API, doesn't persist anything (a page
refresh resets all state to the seed data in `data.js`), and most secondary
actions (`toast('...')` calls with no state change) are intentionally
unimplemented stubs to keep the surface area demonstrable without wiring up
every button.
