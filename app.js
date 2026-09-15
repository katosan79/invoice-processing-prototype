  const ACCOUNTING_SYSTEM = 'Xero'; // swap to reflect whichever system this org has connected — Xero, QBO, MYOB, etc.
  // Org-wide matching policy — a config, not a per-invoice choice (see the
  // Matching settings modal). '3way' checks price + quantity-vs-GRN;
  // '2way' drops the GRN/goods-receipt leg entirely and checks price
  // against the PO only. 'none' drops matching altogether — no PO is
  // required and price/quantity are never checked; an invoice still has to
  // be legible, not a duplicate, and identify a supplier, and its items
  // still have to exist in the market list (an unmapped item is a data
  // problem, not a matching one — it can't be priced or reconciled against
  // anything, matching on or off). Read by computeOutcome(), runChecks(),
  // and build3WayMatch() — flip it and every invoice is re-evaluated fresh
  // via refreshAllTables(), never patched in place.
  let MATCH_MODE = '3way';
  // Declared here rather than beside renderMatchModeButton() below — that
  // function runs during the eager refreshAllTables() call further down
  // this file, so a `const` declared next to it would still be in its
  // temporal dead zone at that point (same trap as BULK_RESOLUTIONS above).
  const MATCH_MODE_LABEL = { '3way':'3-way', '2way':'2-way', 'none':'No matching' };

  // Org-wide tolerance policy — same status as MATCH_MODE: a config, not a
  // per-invoice choice, set via the Tolerance settings modal in the Needs
  // your input tab. Mirrors the real Invoice Agent's defaults (see
  // CLAUDE.md): price ±2%, quantity ±1%. Read by withinPriceTolerance()/
  // withinQtyTolerance() below, which computeOutcome() and runChecks() both
  // call — keep using those helpers rather than re-deriving the comparison
  // inline, or the two will drift out of sync again.
  let PRICE_TOLERANCE_PCT = 2;
  let QTY_TOLERANCE_PCT = 1;

  // A poPrice/qty of 0 would make a percent-of-base comparison divide by
  // zero (and "free" or "zero ordered" lines are rare edge cases, not the
  // scenario tolerance is meant to cover) — fall back to an exact match for
  // those rather than treating a 0 base as "anything goes".
  function withinPriceTolerance(l){
    if (l.poPrice === 0) return Math.abs(l.invPrice) < 0.01;
    return Math.abs(l.invPrice - l.poPrice) <= l.poPrice * (PRICE_TOLERANCE_PCT/100) + 0.001;
  }
  function withinQtyTolerance(l){
    if (l.qty === 0) return l.grn === 0;
    return Math.abs(l.grn - l.qty) <= l.qty * (QTY_TOLERANCE_PCT/100) + 0.001;
  }

  // ── Date range (scopes the KPI stat row + all three tabs) ───────────────
  // Every seeded `date` (e.g. "12 June, 09:40") omits the year — data.js is
  // written as one continuous stretch, all in SEED_YEAR. Parsed once per
  // invoice into a real Date so the range picker has something to compare
  // against, rather than string-sorting date labels.
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const SEED_YEAR = 2026;
  function parseInvDate(inv){
    const m = /^(\d{1,2})\s+([A-Za-z]+),\s+(\d{1,2}):(\d{2})$/.exec(inv.date || '');
    if (!m) return null;
    const monthIdx = MONTH_NAMES.indexOf(m[2]);
    if (monthIdx < 0) return null;
    return new Date(SEED_YEAR, monthIdx, +m[1], +m[3], +m[4]);
  }
  // The demo data sits in a fixed window in the past (June 2026) rather
  // than trailing up to whatever "today" the browser reports — so presets
  // are anchored to the latest seeded invoice, not Date.now(), or "Last 7
  // days" would silently show nothing.
  const LATEST_SEED_DATE = INV.reduce((max, inv) => {
    const d = parseInvDate(inv);
    return d && d > max ? d : max;
  }, new Date(0));
  function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function endOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
  function daysBefore(d, n){ const r = startOfDay(d); r.setDate(r.getDate()-n); return r; }
  function addDays(d, n){ const r = startOfDay(d); r.setDate(r.getDate()+n); return r; }

  // { preset, from, to } — 'all' ignores from/to entirely; every other
  // preset (including 'custom') is a concrete [from,to] window.
  /* ── Bulk resolution policy for Needs your input ───────────────────────
     Only reasons with ONE unambiguous money decision can be settled in a
     batch. Composition problems — an unmapped item, extra items, an item
     set that doesn't match the PO — need a per-item judgement or a data
     fix first, so they're deliberately absent here and the bulk button
     stays disabled for them. Same reasoning buildFooter() uses when it
     gives "Extra items" no default action on the detail screen: if
     resolving it means deciding about money, you can decide for a batch;
     if it means fixing data or judging individual lines, the invoice has
     to be opened.

     Each entry mirrors the primary action the detail screen offers for
     that reason, so bulk and single-invoice resolution can't disagree.
     Declared here rather than beside its functions because
     renderNeedsTab() reads both during the eager refreshAllTables()
     call below — a `const` further down the file would still be in its
     temporal dead zone at that point. ── */
  const BULK_RESOLUTIONS = {
    'Price': {
      label: n => `Approve ${n} price variance${n>1?'s':''} anyway`,
      note: 'Approved with override — logged to audit trail',
      warn: 'Posts above the PO price. Each override is recorded against your name.',
    },
    'Quantity': {
      label: n => `Raise ${n} credit note${n>1?'s':''}`,
      note: 'Credit note drafted — invoice marked resolved',
      warn: 'Drafts a credit note for the over-billed quantity on each invoice.',
    },
    'Total mismatch': {
      label: n => `Approve ${n} anyway`,
      note: 'Approved with override — logged to audit trail',
      warn: "The invoice total doesn't reconcile with its own lines. Each override is recorded.",
    },
    'Items missing': {
      label: n => `Accept ${n} as short-shipped`,
      note: 'Accepted as short-shipped — PO line stays open for the missing item',
      warn: 'Accepts each invoice for what was actually billed. The un-invoiced PO lines stay open.',
    },
  };
  // Selection survives filtering and re-render; keyed by invoice id and
  // narrowed to whatever is currently visible whenever it's read.
  const NEEDS_SELECTION = new Set();

  let DATE_RANGE = { preset:'all', from:null, to:null };
  // Referenced by renderDateRangeCopy(), which runs as part of the eager
  // refreshAllTables() call below — must be defined before that point, not
  // just before its own function definitions further down the file.
  const DR_PRESET_LABEL = { all:'All time', '7':'Last 7 days', '14':'Last 14 days', month:'This month', custom:'Custom range' };
  function applyDateRangePreset(preset){
    if (preset === 'all') { DATE_RANGE = { preset:'all', from:null, to:null }; return; }
    if (preset === '7')   { DATE_RANGE = { preset, from:daysBefore(LATEST_SEED_DATE,6),  to:endOfDay(LATEST_SEED_DATE) }; return; }
    if (preset === '14')  { DATE_RANGE = { preset, from:daysBefore(LATEST_SEED_DATE,13), to:endOfDay(LATEST_SEED_DATE) }; return; }
    if (preset === 'month'){
      const start = new Date(LATEST_SEED_DATE.getFullYear(), LATEST_SEED_DATE.getMonth(), 1);
      DATE_RANGE = { preset, from:start, to:endOfDay(LATEST_SEED_DATE) };
      return;
    }
    // 'custom' is set directly from the date inputs by saveDateRange(), not here.
  }
  function dateInRange(inv){
    if (DATE_RANGE.preset === 'all') return true;
    const d = parseInvDate(inv);
    if (!d) return true; // no parseable date (e.g. a still-digitizing capture) — don't hide it over a filter it can't be judged against
    if (DATE_RANGE.from && d < DATE_RANGE.from) return false;
    if (DATE_RANGE.to && d > DATE_RANGE.to) return false;
    return true;
  }
  function visibleInvoices(){ return INV.filter(dateInRange); }

  function fmt(n){ return 'S$' + n.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}); }

  /* ── supplier avatar: a deterministic colored-initials mark, standing in for a
     real logo — same idea as Gmail/Slack contact avatars. An unknown supplier
     (unreadable capture, no match found) gets a distinct dashed "?" mark instead,
     so those rows are visually obvious at a scan, not just readable in text. ── */
  const SUP_PALETTE = ['#6B4E71','#8C5A3C','#3F6B57','#4E5C8C','#8C6B2E','#5C4E8C','#2E7A6B','#8C4E5C','#4E708C','#6B7A2E'];
  function hashStr(str){
    let h = 0;
    for (let i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i)) >>> 0;
    return h;
  }
  function supplierInitials(name){
    return name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('');
  }
  function supplierAvatar(inv, size){
    size = size || 26;
    const fs = Math.round(size*0.38);
    if (!inv.supplier) {
      return `<span class="sup-avatar sup-avatar-unknown" style="width:${size}px;height:${size}px;font-size:${fs}px;" title="Unknown supplier">?</span>`;
    }
    const color = SUP_PALETTE[hashStr(inv.supplier) % SUP_PALETTE.length];
    return `<span class="sup-avatar" style="width:${size}px;height:${size}px;font-size:${fs}px;background:${color};" title="${inv.supplier}">${supplierInitials(inv.supplier)}</span>`;
  }
  function srcBadge(s){
    if (s==='peppol') return '<span class="badge-src src-peppol"><i class="ti ti-broadcast"></i> PEPPOL</span>';
    if (s==='email')  return '<span class="badge-src src-email"><i class="ti ti-mail"></i> Email</span>';
    if (s==='upload')  return '<span class="badge-src src-pdf"><i class="ti ti-file-text"></i> Web</span>';
    return '<span class="badge-src src-photo"><i class="ti ti-camera"></i> Mobile</span>';
  }
  function pagesBadge(inv){
    const n = inv.pages || 1;
    return n > 1 ? `<span class="pagesbadge">· ${n} pages</span>` : '';
  }
  function grnBadge(inv){
    return inv.viaGRN ? `<span class="pagesbadge">· via GRN${inv.grnRef ? ' '+inv.grnRef : ''}</span>` : '';
  }
  // The "Goods receipt" field on the detail screen — the third document in the
  // 3-way match, sat beside the order number. Counts use the same definition of
  // "received" as computeOutcome() (l.grn !== null) so the sub-line never
  // contradicts the status pill. `missing` lines are left out of the
  // denominator — they were never invoiced, so they're not awaiting receipt.
  function grnFieldHtml(inv){
    if (MATCH_MODE === 'none') return `<span class="grn-empty">Not used — matching is off</span>`;
    if (MATCH_MODE === '2way') return `<span class="grn-empty">Not used — 2-way matching is on</span>`;
    if (inv.legible === false || !inv.po) return `<span class="grn-empty">Not applicable until a PO is linked</span>`;
    const billed = inv.lines.filter(l => !l.missing);
    const total = billed.length, received = billed.filter(l => l.grn !== null).length;
    if (received === 0) {
      return inv.grnRef
        ? `<div class="grn-field"><span class="grn-ref"><i class="ti ti-truck-delivery"></i>${inv.grnRef}</span><div class="grn-sub">Captured from this receipt — no lines matched to it yet</div></div>`
        : `<span class="grn-empty">Awaiting goods receipt</span>`;
    }
    const ref = inv.grnRef || 'Received';
    return `<div class="grn-field">
      <span class="grn-ref"><i class="ti ti-truck-delivery"></i>${ref}</span>
      <div class="grn-sub">${received} of ${total} line${total === 1 ? '' : 's'} received${received < total ? ' — the rest are still open' : ''}</div>
    </div>`;
  }
  const STATUS_HTML = {
    pending:  '<span class="status status-warn"><span class="dot"></span>Awaiting PO match</span>',
    ok:       '<span class="status status-ok"><span class="dot"></span>Ready — auto-post pending</span>',
    approved: '<span class="status status-ok"><span class="dot"></span>Approved</span>',
    exported: '<span class="status status-ok"><span class="dot"></span>Auto-posted</span>',
  };
  // risk/warn covers several distinct reasons now (price, quantity, extra/
  // missing/unmapped items, total mismatch) — blockingReason() already knows
  // which one applies to this invoice, so the detail header's status pill
  // defers to it instead of a single fixed string per status.
  function statusPillHtml(inv){
    if (inv.status === 'risk' || inv.status === 'warn') {
      return `<span class="status ${reasonClass(inv)}"><span class="dot"></span>${blockingReason(inv)} — needs review</span>`;
    }
    return STATUS_HTML[inv.status] || '';
  }

  /* ── completeness status (matches the real Uploads screen) ── */
  /* ══════════ automated processing checks ══════════
     Runs on every invoice not yet finalized by a person (i.e. not approved/
     exported) to decide whether it's clean enough to auto-process ('ok' —
     moves toward Processed) or needs a person's input, and if so, which
     specific reason to lead with. This is the single source of truth for
     inv.status — nothing else sets it except a person's explicit action
     (Approve, Export, Discard) or freshly-captured uploads still digitizing. */
  function reconciledTotal(inv){
    // a "missing" line was never invoiced — no invPrice to sum — so it's
    // excluded rather than contributing NaN to the total.
    return Math.round(inv.lines.filter(l=>!l.missing).reduce((s,l)=>s+l.qty*l.invPrice,0)*1.1*100)/100;
  }
  function computeOutcome(inv){
    // an unreadable capture is a system problem, not a person's decision to make
    // (yet) — request a re-upload/retake and keep it in Uploads rather than
    // routing to Needs your input; nothing about it can be reviewed either way.
    if (inv.legible === false) return { status:'pending', reasonTag:'Unreadable' };
    // a suspected duplicate is a quick yes/no for the uploader to confirm, not a
    // financial judgment call — it stays in Uploads with a one-click resolve,
    // same reasoning as an unreadable capture.
    if (inv.duplicateOf) return { status:'pending', reasonTag:'Duplicate' };
    // an unidentified supplier isn't a person's problem yet — the system keeps
    // trying to identify it (fuzzy match, new-supplier lookup) and the invoice
    // stays in Uploads rather than jumping to Needs your input.
    if (!inv.supplier) return { status:'pending', reasonTag:null };
    // 'none' mode: the org has chosen not to match against a PO or GRN at
    // all — an invoice doesn't need one to post. The one thing that still
    // gets checked is item identity: `lines` only exists once a PO happens
    // to be linked anyway, so this reads `capturedLines` (what the document
    // actually shows, independent of any PO) when there's no `lines` to
    // check instead. Everything below this branch (PO presence, item-set
    // composition, GRN, price, qty, total) is matching-specific and never
    // runs in this mode.
    if (MATCH_MODE === 'none') {
      const checkLines = inv.lines.length ? inv.lines : (inv.capturedLines || []);
      if (checkLines.some(l => l.unmapped)) return { status:'risk', reasonTag:'Unmapped item' };
      return { status:'ok', reasonTag:null };
    }
    // no PO — whether the system hasn't searched yet (matchAttempted:false) or it
    // searched and came up empty, this is still a "find/attach the right document"
    // problem, not a financial judgment call — so it stays in Uploads either way.
    // Linking a PO is a lookup/data-entry action available right here, same as
    // confirming a duplicate or resolving a supplier match.
    if (!inv.po) return { status:'pending', reasonTag: inv.matchAttempted === false ? null : 'No PO linked' };
    // Item-set mismatches — the invoice and PO don't describe the same goods
    // — are a different kind of problem than a receipt-quantity or price
    // variance below, and get checked first: an unmapped item can't even be
    // priced against a catalog, and an extra/missing item makes the
    // per-line price/qty checks below meaningless until it's resolved.
    // l.extra = on the invoice but not the PO (supplier added it by phone/
    // text); l.missing = on the PO but never invoiced (out of stock); l.
    // unmapped = doesn't match any item in the market list at all.
    if (inv.lines.some(l => l.unmapped)) return { status:'risk', reasonTag:'Unmapped item' };
    const hasExtra = inv.lines.some(l => l.extra), hasMissing = inv.lines.some(l => l.missing);
    if (hasExtra && hasMissing) return { status:'risk', reasonTag:'Items differ from PO' };
    if (hasMissing) return { status:'warn', reasonTag:'Items missing' };
    if (hasExtra) return { status:'warn', reasonTag:'Extra items' };
    const total = inv.lines.length, received = inv.lines.filter(l=>l.grn!==null).length;
    // 2-way match never waits on goods receipt — treat it as satisfied so
    // matching proceeds on price alone.
    const hasGRN = MATCH_MODE === '2way' || (total>0 && received===total);
    if (!hasGRN) return { status:'pending', reasonTag:null }; // none or only some lines received — still waiting
    const priceOk = inv.lines.every(withinPriceTolerance);
    if (!priceOk) return { status:'risk', reasonTag:'Price' };
    // Quantity can only be checked against what actually arrived (GRN) —
    // 2-way match doesn't have that leg, so there's nothing to compare.
    const qtyOk = MATCH_MODE === '2way' || inv.lines.every(withinQtyTolerance);
    if (!qtyOk) return { status:'warn', reasonTag:'Quantity' };
    if (Math.abs(inv.amount - reconciledTotal(inv)) > 0.02) return { status:'risk', reasonTag:'Total mismatch' };
    return { status:'ok', reasonTag:null };
  }
  function recomputeAllStatuses(){
    INV.forEach(inv => {
      if (inv.status === 'approved' || inv.status === 'exported') return; // a person already finalized this
      if (inv.freshCapture) return; // still digitizing — nothing to check yet
      const outcome = computeOutcome(inv);
      inv.status = outcome.status;
      if (outcome.reasonTag) inv.reasonTag = outcome.reasonTag;
    });
  }
  /* Every checkpoint the system runs, in order, with a 4-state result:
     pass (green ✓) / fail (rose ✗) / wait (still in flight, not a failure) /
     na (moot — an earlier gate already stopped this invoice going further). */
  function runChecks(inv){
    const legible = inv.legible !== false;
    const supplierKnown = legible && !!inv.supplier;
    if (MATCH_MODE === 'none') {
      // Short checklist to match the short computeOutcome() path for this
      // mode — no PO/GRN/price/qty/total checkpoints exist to show, because
      // this policy skips them, not because they're still "in progress".
      const itemsGated = !legible || !!inv.duplicateOf || !supplierKnown;
      const checkLines = inv.lines.length ? inv.lines : (inv.capturedLines || []);
      const unmapped = !itemsGated && checkLines.some(l => l.unmapped);
      return [
        { label:'Document legible',        state: legible ? 'pass' : 'fail' },
        { label:'Supplier identified',     state: !legible ? 'na' : (inv.supplier ? 'pass' : 'wait') },
        { label:'Invoice number captured', state: legible ? 'pass' : 'na' },
        { label:'Invoice date captured',   state: legible ? 'pass' : 'na' },
        { label:'Not a duplicate',         state: !legible ? 'na' : (inv.duplicateOf ? 'fail' : 'pass') },
        { label:'Items in market list',    state: itemsGated ? 'na' : (unmapped ? 'fail' : 'pass') },
      ];
    }
    const twoWay = MATCH_MODE === '2way';
    const total = inv.lines.length, received = inv.lines.filter(l=>l.grn!==null).length;
    const hasGRN = twoWay || (total>0 && received===total);
    const partialGRN = !twoWay && total>0 && received>0 && received<total;
    const priceOk = hasGRN && inv.lines.every(withinPriceTolerance);
    const qtyOk = twoWay || (hasGRN && inv.lines.every(withinQtyTolerance));
    const totalOk = hasGRN && Math.abs(inv.amount - reconciledTotal(inv)) <= 0.02;
    const poState = (!legible || inv.duplicateOf) ? 'na' : !supplierKnown ? 'wait' : inv.po ? 'pass' : (inv.matchAttempted === false ? 'wait' : 'fail');
    const matchGated = !supplierKnown || !inv.po; // no supplier or no PO yet — everything downstream is moot, not failed
    const itemsMismatch = !matchGated && inv.lines.some(l => l.extra || l.missing || l.unmapped);
    // Once the item set itself doesn't match the PO, receipt/price/qty/total
    // checks below are moot too — they compare invoice lines to PO lines
    // one-to-one, which doesn't mean anything until the composition issue
    // is resolved (there's no PO price to check an unmapped item against,
    // and a missing item was never invoiced in the first place).
    const downstreamGated = matchGated || itemsMismatch;
    const grnLabel = partialGRN ? `GRN received (${received}/${total} lines)` : 'GRN received';
    return [
      { label:'Document legible',        state: legible ? 'pass' : 'fail' },
      { label:'Supplier identified',     state: !legible ? 'na' : (inv.supplier ? 'pass' : 'wait') },
      { label:'Invoice number captured', state: legible ? 'pass' : 'na' },
      { label:'Invoice date captured',   state: legible ? 'pass' : 'na' },
      { label:'Not a duplicate',         state: !legible ? 'na' : (inv.duplicateOf ? 'fail' : 'pass') },
      { label:'PO matched',              state: poState },
      { label:'Items match PO',          state: matchGated ? 'na' : (itemsMismatch ? 'fail' : 'pass') },
      // Goods-receipt and quantity-vs-GRN aren't part of 2-way match at
      // all — the policy removes that leg entirely, so the checkpoints
      // drop out of the list rather than showing as "n/a"/"not required".
      ...(twoWay ? [] : [{ label: grnLabel, state: downstreamGated ? 'na' : (hasGRN ? 'pass' : 'wait') }]),
      { label:'Price matches PO',        state: downstreamGated ? 'na' : (!hasGRN ? 'wait' : (priceOk ? 'pass' : 'fail')) },
      ...(twoWay ? [] : [{ label:'Quantity matches GRN', state: downstreamGated ? 'na' : (!hasGRN ? 'wait' : (qtyOk ? 'pass' : 'fail')) }]),
      { label:'Invoice total reconciles',state: downstreamGated ? 'na' : (!hasGRN ? 'wait' : (totalOk ? 'pass' : 'fail')) },
    ];
  }
  function blockingReason(inv){
    if (inv.freshCapture) return 'Awaiting digitization';
    if (inv.status==='pending') {
      if (inv.legible === false) return 'Unreadable — needs a clearer capture';
      if (inv.duplicateOf) return `Possible duplicate of ${inv.duplicateOf}`;
      if (!inv.supplier) return 'Identifying supplier';
      if (!inv.po) return inv.matchAttempted === false ? 'Matching in progress' : 'No PO linked';
      const total = inv.lines.length, received = inv.lines.filter(l=>l.grn!==null).length;
      if (total>0 && received>0 && received<total) return `Awaiting remaining GRN (${received}/${total})`;
      return 'Awaiting GRN';
    }
    if (inv.status==='risk') {
      if (inv.reasonTag === 'Total mismatch') return "Total doesn't reconcile";
      if (inv.reasonTag === 'Unmapped item') return 'Item not in market list';
      if (inv.reasonTag === 'Items differ from PO') return 'Items differ from PO';
      return 'Price above PO';
    }
    if (inv.status==='warn') {
      if (inv.reasonTag === 'Items missing') return 'Items missing from invoice';
      if (inv.reasonTag === 'Extra items') return 'Extra items not on PO';
      return 'Quantity above GRN';
    }
    return null;
  }
  function reasonClass(inv){
    if (inv.status==='pending' && inv.legible === false) return 'status-risk';
    if (inv.status==='pending' && inv.duplicateOf) return 'status-warn';
    if (inv.status==='pending' && inv.supplier && !inv.po && inv.matchAttempted !== false) return 'status-neutral';
    if (inv.status==='pending') return 'status-info';
    if (inv.status==='risk') return 'status-risk';
    if (inv.status==='warn') return 'status-warn';
    return 'status-ok';
  }
  // Whether this invoice actually has both a price exception AND a quantity
  // exception across its lines. inv.reasonTag / computeOutcome() only ever
  // report one (price is checked first and short-circuits), but the lines
  // underneath can fail both at once — this scans them directly instead of
  // trusting the single reasonTag, so the Needs-your-input row can show both
  // reasons rather than silently dropping one. Only meaningful when the
  // invoice's primary reason is itself a price/quantity variance (not an
  // item-set problem like Extra items, which never gets financial checks).
  function invoiceHasBothPriceAndQtyIssues(inv){
    if (MATCH_MODE === '2way') return false;
    if (inv.reasonTag !== 'Price' && inv.reasonTag !== 'Quantity') return false;
    if (!inv.lines || !inv.lines.length) return false;
    const relevant = inv.lines.filter(l => !l.extra && !l.unmapped && !l.missing);
    const hasPriceIssue = relevant.some(l => !withinPriceTolerance(l));
    const hasQtyIssue = relevant.some(l => l.grn !== null && !withinQtyTolerance(l));
    return hasPriceIssue && hasQtyIssue;
  }
  // The reason pill(s) shown on a Needs-your-input row — one pill normally,
  // or Price + Quantity stacked side by side when both apply to the same
  // invoice. Deliberately doesn't touch inv.reasonTag itself: that single
  // value still drives filtering, the bulk-resolution action, and the
  // detail-screen header pill elsewhere, and widening those is a bigger,
  // separate change.
  function reasonPillsHtml(inv){
    if (!invoiceHasBothPriceAndQtyIssues(inv)) {
      return `<span class="status ${reasonClass(inv)}"><span class="dot"></span>${inv.reasonTag}</span>`;
    }
    return `<span class="reason-pills">
      <span class="status status-risk"><span class="dot"></span>Price</span>
      <span class="status status-warn"><span class="dot"></span>Quantity</span>
    </span>`;
  }
  function renderCompleteness(inv){
    if (inv.freshCapture) {
      return `<div class="cstat"><span style="color:var(--text-soft);font-size:12px;">N/A — digitizing…</span></div>`;
    }
    const complete = ['ok','approved','exported'].includes(inv.status);
    const reason = complete ? 'Complete' : blockingReason(inv);
    return `<div class="cstat">
      <span class="status ${reasonClass(inv)} cstat-pill" onclick="event.stopPropagation();toggleChecklist(this,'${inv.id}')"><span class="dot"></span>${reason}<span class="car">▾</span></span>
    </div>`;
  }
  /* ── checklist popover: one shared element, positioned next to whichever
     pill was clicked. Clicking the same pill again, clicking elsewhere, or
     scrolling the page closes it — same dismiss model as the PO type-ahead
     suggestion list, so nothing about the table itself ever has to move. ── */
  function toggleChecklist(pillEl, id){
    const pop = document.getElementById('cstat-popover');
    if (pop.classList.contains('open') && pop.dataset.forId === id) { closeChecklist(); return; }
    const inv = findInv(id);
    if (!inv) return;
    const stateIcon = { pass:'✓', fail:'✗', wait:'…', na:'–' };
    const stateClass = { pass:'done', fail:'fail', wait:'wait', na:'pending' };
    pop.innerHTML = `
      <div class="hd">Checklist<button class="x" onclick="closeChecklist()">✕</button></div>
      ${runChecks(inv).map(c=>`<div class="item ${stateClass[c.state]}"><span class="ic">${stateIcon[c.state]}</span>${c.label}</div>`).join('')}
    `;
    pop.dataset.forId = id;
    pop.classList.add('open'); // add first so offsetWidth below reflects its real (post-content) size
    const r = pillEl.getBoundingClientRect();
    const pw = pop.offsetWidth || 260;
    let left = Math.min(r.left, window.innerWidth - pw - 12);
    pop.style.left = Math.max(12, left) + 'px';
    pop.style.top = (r.bottom + 8) + 'px';
  }
  function closeChecklist(){
    const pop = document.getElementById('cstat-popover');
    pop.classList.remove('open');
    delete pop.dataset.forId;
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('#cstat-popover') && !e.target.closest('.cstat-pill')) closeChecklist();
  });
  // capture:true so this also fires for scroll on the table's own scroll
  // container, not just the window — scroll events don't bubble on their own.
  document.addEventListener('scroll', () => closeChecklist(), true);

  /* ══════════ editable OCR fields + audit trail ══════════
     The system pre-fills every field from OCR/extraction, but a person can
     always overwrite what it returned — a wrong supplier name, a misread
     invoice number, a mis-keyed line price. Nothing is silently corrected:
     every change writes an entry to inv.auditTrail (field, old → new, who,
     when), viewable via the History button in the document header. ── */
  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function nowStamp(){
    return new Date().toLocaleString('en-AU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
  }
  function logAudit(inv, field, from, to){
    if (!inv.auditTrail) inv.auditTrail = [];
    inv.auditTrail.push({ field, from: (from==null || from==='') ? '(empty)' : from, to: (to==null || to==='') ? '(empty)' : to, by:'Keith Tan', at: nowStamp() });
  }
  // Renders a header field (Supplier / Delivered to / Invoice number / Invoice
  // date) as a quiet, click-to-edit input rather than static text. `prop` is
  // the field on the invoice object to write back to on change; `label` is
  // what shows up in the audit trail and on the "edited" tag's tooltip.
  function fieldInput(inv, prop, label, value){
    const edited = (inv.auditTrail||[]).some(a => a.field === label);
    return `<div class="field-edit-wrap">
      <input class="field-input" value="${escapeHtml(value)}" onchange="commitFieldEdit('${inv.id}','${prop}','${label}',this.value)"/>
      ${edited ? `<span class="edited-tag" title="Corrected by a person — see History">edited</span>` : ''}
    </div>`;
  }
  function commitFieldEdit(id, prop, label, newValue){
    const inv = findInv(id);
    if (!inv) return;
    const oldValue = inv[prop] != null ? inv[prop] : (prop==='rawReference' ? inv.id : '');
    newValue = (newValue||'').trim();
    if (newValue === (oldValue||'')) return;
    logAudit(inv, label, oldValue, newValue);
    inv[prop] = newValue;
    toast(`${label} updated`);
    refreshAllTables();
    openDetail(inv.id, window._detailFrom);
  }
  // Line-item edits (description/qty/unit size/unit price) — same log-then-
  // rerender pattern as commitFieldEdit, plus a status recompute since qty
  // and price feed straight into the PO/GRN match (computeOutcome()).
  function commitLineEdit(invId, idx, prop, label, newValue){
    const inv = findInv(invId);
    if (!inv || !inv.lines[idx]) return;
    const line = inv.lines[idx];
    const oldValue = line[prop];
    if (prop === 'qty' || prop === 'invPrice') {
      newValue = parseFloat(newValue);
      if (isNaN(newValue)) { toast('Enter a valid number'); openDetail(inv.id, window._detailFrom); return; }
    } else {
      newValue = (newValue||'').trim();
    }
    if (newValue === oldValue) return;
    logAudit(inv, `${label} — ${line.name}`, oldValue, newValue);
    line[prop] = newValue;
    line.edited = true;
    recomputeAllStatuses();
    refreshAllTables();
    toast(`${label} updated`);
    openDetail(inv.id, window._detailFrom);
  }
  // The header "History" button — hidden when nothing's been edited yet, so
  // an untouched invoice's header doesn't grow a button nobody needs.
  function renderHistoryButton(inv){
    const el = document.getElementById('d-history');
    const n = (inv.auditTrail||[]).length;
    el.innerHTML = n
      ? `<button class="history-btn" onclick="event.stopPropagation();toggleHistory(this,'${inv.id}')"><i class="ti ti-clock"></i> History <span style="opacity:.75">(${n})</span></button>`
      : '';
  }
  function toggleHistory(btnEl, id){
    const pop = document.getElementById('history-popover');
    if (pop.classList.contains('open') && pop.dataset.forId === id) { closeHistory(); return; }
    const inv = findInv(id);
    if (!inv) return;
    const entries = (inv.auditTrail||[]).slice().reverse();
    pop.innerHTML = `
      <div class="hd">Edit history<button class="x" onclick="closeHistory()">✕</button></div>
      <div class="hist-body" id="hist-body">
        ${entries.length ? entries.map(a => `
          <div class="hist-item">
            <div class="hist-field">${escapeHtml(a.field)}</div>
            <div class="hist-change"><span class="from">${escapeHtml(a.from)}</span><span class="arrow">→</span><span class="to">${escapeHtml(a.to)}</span></div>
            <div class="hist-meta">${escapeHtml(a.by)} · ${escapeHtml(a.at)}</div>
          </div>`).join('') : `<div class="history-empty">No corrections yet</div>`}
      </div>
      <div class="hist-fade" id="hist-fade"></div>
    `;
    pop.dataset.forId = id;
    pop.classList.add('open');
    const r = btnEl.getBoundingClientRect();
    const pw = pop.offsetWidth || 300;
    let left = Math.min(r.left, window.innerWidth - pw - 12);
    pop.style.left = Math.max(12, left) + 'px';
    pop.style.top = (r.bottom + 8) + 'px';
    updateHistFade();
    document.getElementById('hist-body').addEventListener('scroll', updateHistFade);
  }
  // Shows the bottom fade only while there's actually more to scroll to —
  // re-checked on open and on every scroll, so it disappears once you've
  // reached the last entry instead of lingering as decoration.
  function updateHistFade(){
    const body = document.getElementById('hist-body');
    const fade = document.getElementById('hist-fade');
    if (!body || !fade) return;
    const moreBelow = body.scrollHeight - body.scrollTop - body.clientHeight > 4;
    fade.classList.toggle('show', moreBelow);
  }
  function closeHistory(){
    const pop = document.getElementById('history-popover');
    pop.classList.remove('open');
    delete pop.dataset.forId;
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('#history-popover') && !e.target.closest('.history-btn')) closeHistory();
  });
  // capture:true so this closes on scroll anywhere in the page — except a
  // scroll inside the history list itself, which should just scroll (that's
  // the whole point of hist-body's own scrollbar, not a reason to dismiss).
  document.addEventListener('scroll', e => {
    if (e.target && e.target.closest && e.target.closest('#history-popover')) return;
    closeHistory();
  }, true);

  /* ── list toolbar: search + outlet/reason filter + sort, shared by all three
     tabs. Counts/badges everywhere else stay computed off the FULL set — only
     what's rendered in the table/cards is affected by these controls. ── */
  const LIST_CTL = {
    uploads: { query:'', outlet:'', sort:'new' },
    needs:   { query:'', outlet:'', sort:'new', reason:'' },
    proc:    { query:'', outlet:'', sort:'new' },
  };
  function updateListCtl(tab, field, value){
    LIST_CTL[tab][field] = value;
    if (tab === 'uploads') renderUploadsTable();
    else if (tab === 'needs') renderNeedsTab();
    else if (tab === 'proc') renderProcTable();
  }
  function matchesQuery(inv, q){
    if (!q) return true;
    q = q.toLowerCase();
    return (inv.supplier||'').toLowerCase().includes(q) || inv.id.toLowerCase().includes(q);
  }
  function matchesOutlet(inv, outlet){ return !outlet || (inv.outlet||'') === outlet; }
  function sortList(list, sortKey){
    const arr = list.slice();
    if (sortKey === 'old') arr.reverse();
    else if (sortKey === 'supplier') arr.sort((a,b) => (a.supplier||'zzz').localeCompare(b.supplier||'zzz'));
    else if (sortKey === 'amount') arr.sort((a,b) => b.amount - a.amount);
    return arr; // 'new' (default): natural order — newest captures are unshifted to the front already
  }
  function applyListCtl(list, tab){
    const ctl = LIST_CTL[tab];
    let out = list.filter(inv => matchesQuery(inv, ctl.query) && matchesOutlet(inv, ctl.outlet));
    if (ctl.reason) out = out.filter(inv => inv.reasonTag === ctl.reason);
    return sortList(out, ctl.sort);
  }

  /* ── pipeline model: every invoice sits in exactly ONE stage at a time ──
     Uploads = still in flight (just captured / awaiting PO or GRN match)
     Needs your input = an exception a person must resolve
     Invoices = resolved (matched cleanly, approved, or exported)
     An invoice moves out of one tab and into the next as its status changes —
     it never sits in more than one, so none of these lists grows unbounded. */
  function getUploads(){ return visibleInvoices().filter(i => i.status === 'pending'); }
  function getNeeds(){ return visibleInvoices().filter(i => ['risk','warn'].includes(i.status)); }
  function getProcessed(){ return visibleInvoices().filter(i => ['ok','approved','exported'].includes(i.status)); }

  /* ── detail-screen prev/next — the same filtered/sorted list the table
     itself is showing for whichever tab the detail view was opened from,
     so paging through it lands on exactly what's visually next in that
     list, current search/filter/sort included. ── */
  function getTabList(tab){
    if (tab === 'uploads') return applyListCtl(getUploads(), 'uploads');
    if (tab === 'needs') return applyListCtl(getNeeds(), 'needs');
    if (tab === 'proc') {
      const stageFiltered = getProcessed().filter(inv =>
        window._procFilter === 'exported' ? inv.status === 'exported' : inv.status !== 'exported'
      );
      return applyListCtl(stageFiltered, 'proc');
    }
    return [];
  }
  function renderDetailPager(){
    const pager = document.getElementById('detail-pager');
    if (!pager || !window._currentInv) return;
    const list = getTabList(window._detailFrom || 'uploads');
    const idx = list.findIndex(i => i.id === window._currentInv.id);
    window._detailList = list;
    window._detailIndex = idx;
    if (list.length < 2 || idx === -1) { pager.innerHTML = ''; return; }
    pager.innerHTML = `
      <button onclick="navigateDetail(-1)" ${idx<=0?'disabled':''} title="Previous (←)">‹</button>
      <span>${idx+1} of ${list.length}</span>
      <button onclick="navigateDetail(1)" ${idx>=list.length-1?'disabled':''} title="Next (→)">›</button>
    `;
  }
  function navigateDetail(delta){
    const list = window._detailList;
    if (!list) return;
    const next = window._detailIndex + delta;
    if (next < 0 || next >= list.length) return;
    openDetail(list[next].id, window._detailFrom);
  }
  // Left/Right arrow keys page through the same list, wherever focus
  // happens to be on the detail screen — except inside a text field/select,
  // where the arrow keys need to keep doing their normal job (moving the
  // cursor, picking an option) rather than jumping to another invoice.
  document.addEventListener('keydown', e => {
    const detailView = document.getElementById('v-detail');
    if (!detailView || !detailView.classList.contains('on')) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (['INPUT','SELECT','TEXTAREA'].includes(tag)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigateDetail(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navigateDetail(1); }
  });

  /* ── landing-page stats ── */
  // Financial-variance reasons have a $ amount worth surfacing; item-set
  // composition issues (extra/missing/unmapped) don't map to an overbilled
  // figure the same way, so they're excluded from the "caught" total.
  const FINANCIAL_REASON_TAGS = ['Price', 'Quantity', 'Total mismatch'];
  function exceptionCaughtAmount(inv){
    if (inv.reasonTag === 'Price') return inv.lines.reduce((s,l)=> s + Math.max(0,(l.invPrice-l.poPrice))*(l.qty||0), 0);
    if (inv.reasonTag === 'Quantity') return inv.lines.reduce((s,l)=> s + Math.max(0,(l.qty-(l.grn||0)))*(l.invPrice||0), 0);
    if (inv.reasonTag === 'Total mismatch') return Math.abs(inv.amount - reconciledTotal(inv));
    return 0;
  }
  function computeStats(){
    const needs = getNeeds();
    const needsValue = needs.reduce((s,i)=>s+i.amount,0);
    // "Decided" = has been through matching one way or another — either it
    // cleared automatically (ok/approved/exported, no exception reason) or
    // it needed a human (currently sitting in Needs, any reason). Still-
    // pending uploads (no supplier/PO/GRN yet) aren't decided either way,
    // so they're excluded from the rate rather than counted as a miss.
    const decided = visibleInvoices().filter(i => ['ok','approved','exported','risk','warn'].includes(i.status));
    const clearedCount = decided.filter(i => !FINANCIAL_REASON_TAGS.concat(['Extra items','Items missing','Unmapped item','Items differ from PO']).includes(i.reasonTag)).length;
    const autoClearRate = decided.length ? Math.round(clearedCount/decided.length*100) : 0;
    const exceptionsCaught = visibleInvoices().reduce((s,i)=> s + exceptionCaughtAmount(i), 0);
    return { needsValue, needsCount: needs.length, autoClearRate, exceptionsCaught };
  }
  function renderStats(){
    const s = computeStats();
    document.getElementById('statrow').innerHTML = `
      <div class="stat-tile">
        <div class="lab">Awaiting review</div>
        <div class="val">${fmt(s.needsValue)}</div>
        <div class="sub">across ${s.needsCount} invoice${s.needsCount!==1?'s':''}</div>
      </div>
      <div class="stat-tile">
        <div class="lab">Auto-clear rate</div>
        <div class="val">${s.autoClearRate}%</div>
        <div class="sub">matched with no review needed</div>
      </div>
      <div class="stat-tile">
        <div class="lab">Exceptions caught</div>
        <div class="val">${fmt(s.exceptionsCaught)}</div>
        <div class="sub">in price/quantity overbilling flagged before posting</div>
      </div>
    `;
  }

  function renderUploadsTable(){
    const uploads = getUploads();
    const shown = applyListCtl(uploads, 'uploads');
    document.getElementById('tb-uploads').innerHTML = shown.length ? shown.map(inv => {
      const clickable = !inv.freshCapture; // still digitizing — nothing extracted yet to view or edit
      const unread = !inv.viewed && clickable;
      const rowOpen = clickable
        ? `<tr class="rowlink${unread ? ' unviewed' : ''}" onclick="openDetail('${inv.id}','uploads')">`
        : `<tr${unread ? ' class="unviewed"' : ''}>`;
      const viewBtn = clickable
        ? `<button class="btn btn-ghost" onclick="event.stopPropagation();openDetail('${inv.id}','uploads')">View/edit</button>`
        : `<button class="btn btn-ghost" disabled title="Still digitizing — nothing to view yet">View/edit</button>`;
      return `${rowOpen}
        <td><div class="upl-date">${unread ? '<span class="unread-dot" title="Not yet viewed"></span>' : ''}${inv.date}</div><div class="upl-meta">${srcBadge(inv.source)}${grnBadge(inv)}${pagesBadge(inv)}<span>· ${inv.by}</span></div></td>
        <td class="${unread ? 'unread-text' : ''}">${inv.id}</td><td>${inv.freshCapture ? 'N/A' : (inv.poDate||inv.date.split(',')[0])}</td><td>${inv.outlet||'—'}</td>
        <td><div class="sup-cell">${supplierAvatar(inv)}<span class="${unread ? 'unread-text' : ''}">${inv.supplier||'Unknown supplier'}</span></div></td>
        <td>${renderCompleteness(inv)}</td>
        <td style="white-space:nowrap;">
          ${viewBtn}
          <button class="btn-icon-del" title="Delete this upload" onclick="event.stopPropagation();openDeleteModal('${inv.id}')"><i class="ti ti-trash"></i></button>
        </td>
      </tr>`;
    }).join('') : `<tr><td colspan="7"><div class="emptystate">${uploads.length ? '✓ No matches — try a different search or filter' : '✓ Nothing in flight — every capture has been matched or triaged'}</div></td></tr>`;
  }

  function renderNeedsTab(){
    const needs = getNeeds();
    const shown = applyListCtl(needs, 'needs');
    document.getElementById('tb-needs').innerHTML = shown.length ? shown.map(inv => `
    <div class="exc" onclick="openDetail('${inv.id}','needs')">
      <input type="checkbox" class="needs-check" data-id="${inv.id}"${NEEDS_SELECTION.has(inv.id) ? ' checked' : ''} onclick="event.stopPropagation()" onchange="toggleNeedsCheck('${inv.id}', this.checked)">
      <div>
        <div class="supplier sup-cell">${supplierAvatar(inv)}<span>${inv.supplier || 'Unknown supplier'} — INV ${inv.id.replace('INV-','')} <span class="amt2">${fmt(inv.amount)}</span></span></div>
        <div class="why">${reasonPillsHtml(inv)}${inv.why}</div>
      </div>
      <button class="btn btn-ghost" onclick="event.stopPropagation();openDetail('${inv.id}','needs')">Review</button>
    </div>`).join('') : `<div class="emptystate">${needs.length ? '✓ No matches — try a different search or filter' : '✓ Nothing needs your input right now'}</div>`;
    // Re-rendering replaces the checkboxes, so re-sync the bulk bar against
    // whatever is still both selected and visible.
    updateNeedsSelection();
  }

  /* ── Invoices tab bounds itself with a status sub-filter: 'action needed' (ok +
     approved — still wants something from you) stays the default view and is
     always small; 'exported' is the pure archive and only renders when chosen. ── */
  window._procFilter = window._procFilter || 'action';
  function setProcFilter(f){
    window._procFilter = f;
    document.querySelectorAll('.sf-btn').forEach(b => b.classList.toggle('on', b.dataset.sf === f));
    renderProcTable();
  }
  function renderProcTable(){
    const stageFiltered = getProcessed().filter(inv =>
      window._procFilter === 'exported' ? inv.status === 'exported' : inv.status !== 'exported'
    );
    const processed = applyListCtl(stageFiltered, 'proc');
    document.querySelector('.sf-btn[data-sf="action"] .n').textContent = getProcessed().filter(i=>i.status!=='exported').length;
    document.querySelector('.sf-btn[data-sf="exported"] .n').textContent = getProcessed().filter(i=>i.status==='exported').length;
    document.getElementById('tb-proc').innerHTML = processed.length ? processed.map(inv => `
    <tr class="rowlink" onclick="openDetail('${inv.id}','proc')">
      <td>${inv.poDate||inv.date}</td><td>${inv.id}</td>
      <td><div class="sup-cell">${supplierAvatar(inv)}<span>${inv.supplier}</span></div></td>
      <td>${inv.outlet||'—'}</td><td class="amt">${fmt(inv.amount)}</td>
      <td>${inv.status==='approved'
        ? `<span class="status status-ok"><span class="dot"></span>Approved w/ Keith Tan</span>${inv.resolutionNote ? `<div class="posted-note">${inv.reasonTag ? inv.reasonTag + ' · ' : ''}${inv.resolutionNote}</div>` : ''}`
        : '<span class="status status-ok"><span class="dot"></span>Auto-posted</span>'}</td>
      <td>${inv.status==='exported' ? `<span style="color:var(--fern);font-weight:700;">✓ Synced to ${ACCOUNTING_SYSTEM}</span>` : inv.status==='approved' ? `<a href="#" class="xerolink" onclick="event.preventDefault();event.stopPropagation();exportInvoice('${inv.id}')">Export to ${ACCOUNTING_SYSTEM} →</a>` : '<span class="status status-neutral"><span class="dot"></span>Not yet — pending approval</span>'}</td>
      <td><button class="btn btn-ghost" onclick="event.stopPropagation();openDetail('${inv.id}','proc')">View</button></td>
    </tr>`).join('') : `<tr><td colspan="7"><div class="emptystate">${stageFiltered.length ? '✓ No matches — try a different search or filter' : (window._procFilter === 'exported' ? '✓ Nothing exported yet' : '✓ Nothing waiting on you — check Exported for history')}</div></td></tr>`;
  }

  function updateCounts(){
    const needs = getNeeds();
    document.querySelector('.tab[data-v="uploads"] .n').textContent = getUploads().length;
    document.querySelector('.tab[data-v="needs"] .n').textContent = needs.length;
  }

  function refreshAllTables(){
    recomputeAllStatuses();
    renderUploadsTable();
    renderNeedsTab();
    renderProcTable();
    updateCounts();
    renderStats();
    renderDateRangeCopy();
  }
  refreshAllTables();
  renderMatchModeButton();
  renderToleranceCopy();

  // The stat row and tab bar are queue-level chrome — they summarize and
  // navigate between Uploads/Needs/Processed, which stop meaning anything
  // once you're heads-down on one invoice. Hidden whenever the detail view
  // is open (see openDetail()) and restored by showTab(), which is the
  // only way back to a list view (including the detail screen's own Back
  // button — see BACK_LABELS/backBtn.onclick below).
  /* ── mobile nav drawer ── */
  // The sidebar is a normal sticky column above the 860px breakpoint (the
  // media query never applies there), so these only ever get invoked via
  // the hamburger button that CSS also hides above that width.
  function toggleSidebar(){
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-backdrop').classList.toggle('show');
  }
  function closeSidebar(){
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-backdrop').classList.remove('show');
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSidebar();
  });
  function setQueueChromeVisible(visible){
    document.getElementById('statrow-wrap').style.display = visible ? '' : 'none';
    document.getElementById('tabsrow').style.display = visible ? '' : 'none';
    document.getElementById('topbar-queue-actions').style.display = visible ? '' : 'none';
  }
  function showTab(v){
    setQueueChromeVisible(true);
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.v===v));
    document.querySelectorAll('.view').forEach(s => s.classList.remove('on'));
    document.getElementById('v-'+v).classList.add('on');
    document.getElementById('page-title').textContent = v==='upload' ? 'Upload invoice' : v==='detail' ? 'Invoice detail' : 'Invoices';
    window.scrollTo({top:0,behavior:'smooth'});
  }
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.v)));

  const BACK_LABELS = { uploads:'Uploads', needs:'Needs your input', proc:'Processed' };

  /* ── Status-specific top toolbar (dochead) ── */
  function buildToolbar(inv){
    const refresh = `<button onclick="toast('Refreshing extracted data…')"><i class="ti ti-refresh"></i> Refresh data</button>`;
    if (inv.status === 'exported') return `<span style="color:#9FA89F;font-size:12px;align-self:center;">Exported to ${inv.exportedTo||ACCOUNTING_SYSTEM} · read-only</span>`;
    if (inv.status === 'approved') return refresh + `<button style="background:var(--fern);border-color:var(--fern);color:#fff;font-weight:700;" onclick="exportInvoice('${inv.id}')">Export to ${ACCOUNTING_SYSTEM}</button>`;
    if (inv.status === 'ok')       return refresh + `<button style="background:var(--fern);border-color:var(--fern);color:#fff;font-weight:700;" onclick="approveInvoice('${inv.id}')">Approve</button>`;
    if (inv.legible === false)    return `<button onclick="toast('Reupload requested — the uploader will be asked for a clearer capture')"><i class="ti ti-camera"></i> Request re-upload</button><button style="background:var(--rose);border-color:var(--rose);color:#fff;font-weight:700;" onclick="rejectUpload('${inv.id}')"><i class="ti ti-trash"></i> Reject upload</button>`;
    if (inv.duplicateOf)          return `<span style="color:#9FA89F;font-size:12px;align-self:center;">Matched against ${inv.duplicateOf} — confirm below before this proceeds</span>`;
    if (inv.status === 'pending' && inv.supplier && !inv.po && inv.matchAttempted !== false)
      return refresh + `<span style="color:#9FA89F;font-size:12px;align-self:center;">No matching PO found — link one manually below</span><button onclick="openDeleteModal('${inv.id}')"><i class="ti ti-trash"></i> Delete upload</button>`;
    if (inv.status === 'pending')  return refresh + `<span style="color:#9FA89F;font-size:12px;align-self:center;">Awaiting GRN before matching can complete</span><button onclick="openDeleteModal('${inv.id}')"><i class="ti ti-trash"></i> Delete upload</button>`;
    // risk / warn — an exception still being reviewed
    return refresh + `<button onclick="discardInvoice('${inv.id}')">Discard</button><button onclick="toast('Draft saved')">Save draft</button><button style="background:var(--fern);border-color:var(--fern);color:#fff;font-weight:700;" onclick="approveInvoice('${inv.id}','Invoice posted')">Post invoice</button>`;
  }

  /* ── Status-specific footer (below the line items / totals) ── */
  function buildFooter(inv){
    const chat = `<button class="btn-text" onclick="toast('Opens a colleague-review thread on this invoice')"><i class="ti ti-message-circle"></i> Check with a colleague</button>`;
    if (inv.legible === false) {
      return `<div style="font-size:12px;color:var(--text-soft);">Not a valid invoice yet — reject it or ask for a clearer capture above</div>${chat}`;
    }
    if (inv.duplicateOf) {
      return `<div style="display:flex;gap:10px;flex-wrap:wrap;"><button class="btn btn-go" onclick="discardInvoice('${inv.id}')"><i class="ti ti-trash"></i> Discard as duplicate</button><button class="btn btn-ghost" onclick="continueNotDuplicate('${inv.id}')">Not a duplicate — continue</button></div>${chat}`;
    }
    if (inv.status === 'pending' && inv.supplier && !inv.po && inv.matchAttempted !== false) {
      return `<div style="font-size:12px;color:var(--text-soft);">Enter the PO number above, under Order number, to link it manually</div>${chat}`;
    }
    if (inv.status === 'risk' || inv.status === 'warn') {
      // Warn-status primary action depends on WHY it's a warn, not just that
      // it is one: "Raise credit note" only makes sense when the supplier
      // overbilled (Quantity above GRN). "Items missing" is the opposite —
      // nothing was overbilled, a PO item just never showed up on the
      // invoice — so there's nothing to credit; the invoice can be accepted
      // as-is for what was actually billed, with the PO line left open.
      // "Extra items" is ambiguous enough (could be a legit phone/text add,
      // could be unauthorized) that it gets no default primary action —
      // Flag for follow-up / Notify manager are the safe options.
      let primary = '';
      if (inv.status === 'warn' && inv.reasonTag === 'Items missing') {
        primary = `<button class="btn btn-go" onclick="approveInvoice('${inv.id}','Accepted as short-shipped — PO line stays open for the missing item')"><i class="ti ti-package"></i> Accept as short-shipped</button>`;
      } else if (inv.status === 'warn' && inv.reasonTag === 'Extra items') {
        primary = '';
      } else if (inv.status === 'warn') {
        primary = `<button class="btn btn-go" onclick="approveInvoice('${inv.id}','Credit note drafted — invoice marked resolved')"><i class="ti ti-receipt-2"></i> Raise credit note</button>`;
      } else {
        primary = `<button class="btn btn-go" onclick="approveInvoice('${inv.id}','Approved with override — logged to audit trail')"><i class="ti ti-check"></i> Approve anyway</button>`;
      }
      return `<div style="display:flex;gap:10px;flex-wrap:wrap;">${primary}<button class="btn btn-ghost" onclick="toast('Flagged for follow-up')"><i class="ti ti-flag"></i> Flag for follow-up</button><button class="btn btn-ghost" onclick="toast('Manager notified — Priya Shah will review')"><i class="ti ti-bell"></i> Notify manager</button></div>${chat}`;
    }
    return `${chat}<div style="font-size:12px;color:var(--text-soft);">One action bar — no more split top/bottom controls</div>`;
  }

  // ── Reference data for the source-document mockup only — decorative
  // dressing (address/ABN/bank details), never read by matching logic.
  // Keyed by the exact supplier/outlet strings already used in data.js;
  // add an entry here when a new supplier or outlet is added there, or
  // it falls back to the generic entry below.
  const SUPPLIER_INFO = {
    'Sydney Butchers Co.':      { category:'Meat & Seafood',    addr:'12 Anzac Parade, Sydney NSW 2000',       abn:'54 321 987 654', phone:'+61 2 9000 1234', email:'orders@sydneybutchers.com.au',      bank:'Commonwealth Bank · BSB 062-000 · Acc 1234 5678' },
    'Green Farmers Market':     { category:'Fresh Produce',     addr:'8 Flemington Markets Rd, Sydney NSW 2140', abn:'22 114 556 903', phone:'+61 2 9764 2200', email:'orders@greenfarmersmarket.com.au', bank:'Westpac · BSB 032-001 · Acc 9012 3456' },
    'Harbour Meats':            { category:'Premium Meats',     addr:'4 Wharf Rd, Newtown NSW 2042',            abn:'67 902 331 118', phone:'+61 2 9550 7788', email:'accounts@harbourmeats.com.au',      bank:'ANZ · BSB 012-345 · Acc 5566 7788' },
    'Metro Bakery Supplies':    { category:'Bakery & Provisions', addr:'21 Baker St, Bondi Beach NSW 2026',     abn:'39 220 774 662', phone:'+61 2 9130 4455', email:'orders@metrobakery.com.au',        bank:'NAB · BSB 084-006 · Acc 3344 5566' },
    'Pacific Drinks Wholesale': { category:'Beverages',         addr:'15 Harbourfront Dr, Melbourne VIC 3000', abn:'88 445 213 907', phone:'+61 3 9642 1180', email:'sales@pacificdrinks.com.au',        bank:'CommBank · BSB 062-100 · Acc 7788 9900' },
    'Fresh Produce Co':         { category:'Fruit & Vegetables', addr:'6 Growers Ln, Melbourne CBD VIC 3000',  abn:'15 663 890 244', phone:'+61 3 9204 5567', email:'orders@freshproduceco.com.au',     bank:'Westpac · BSB 032-002 · Acc 2233 4455' },
  };
  const GENERIC_SUPPLIER_INFO = { category:'Supplier', addr:'', abn:'', phone:'', email:'', bank:'' };
  const OUTLET_INFO = {
    'Bondi Beach':       { addr:'168 Campbell Parade, Bondi Beach NSW 2026', window:'6:00 AM – 8:00 AM' },
    'Newtown':           { addr:'305 King St, Newtown NSW 2042',             window:'6:30 AM – 8:30 AM' },
    'Parramatta Table':  { addr:'2 Church St, Parramatta NSW 2150',          window:'7:00 AM – 9:00 AM' },
    'Melbourne CBD':     { addr:'88 Collins St, Melbourne VIC 3000',         window:'6:00 AM – 8:00 AM' },
    'Surry Hills':       { addr:'412 Crown St, Surry Hills NSW 2010',        window:'7:00 AM – 9:00 AM' },
  };
  const GENERIC_OUTLET_INFO = { addr:'', window:'' };
  // The restaurant group operating every outlet in this prototype — distinct
  // from "nomni Procure", the software brand in the sidebar.
  const BUYER_INFO = { name:'HARBOUR HOSPITALITY GROUP PTY LTD', abn:'91 604 218 337' };

  /* ── mocked source-document preview (every invoice gets one; multi-page
     examples paginate). Field set is modeled on a real AU tax invoice —
     supplier letterhead, invoice/delivery/due dates, PO reference, Bill
     To / Deliver To, a per-line unit price, and a Subtotal/GST/Total
     breakdown — so it reads as a real captured document, not a stub. ── */
  function buildDocMockup(inv, page){
    if (inv.legible === false) {
      return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:170px;color:#b0b0b0;text-align:center;gap:8px;">
        <div style="font-size:30px;"><i class="ti ti-cloud-fog"></i></div>
        <div style="font-size:11.5px;font-weight:700;color:#8a8a8a;">Image unreadable</div>
        <div style="font-size:10px;max-width:210px;line-height:1.5;">Too blurry to extract a supplier, invoice number, or amount</div>
      </div>`;
    }
    const totalPages = inv.pages || 1;
    // The source-document mockup shows whatever the capture actually extracted
    // (capturedLines) even before a PO exists to match against — inv.lines is
    // a separate, PO-matching-specific list that starts empty until a person
    // links a PO, and shouldn't be what decides whether the document "has"
    // line items on it.
    const docLines = (inv.capturedLines && inv.capturedLines.length) ? inv.capturedLines : inv.lines;
    const lines = (docLines && docLines.length) ? docLines : [{name:'No line items captured yet', qty:'', invPrice:0}];
    const perPage = totalPages > 1 ? Math.ceil(lines.length / totalPages) : lines.length;
    const pageLines = totalPages > 1 ? lines.slice((page-1)*perPage, (page-1)*perPage + perPage) : lines;
    const showTotal = page === totalPages;
    const showHeader = page === 1;

    const sup = SUPPLIER_INFO[inv.supplier] || GENERIC_SUPPLIER_INFO;
    const out = OUTLET_INFO[inv.outlet] || GENERIC_OUTLET_INFO;
    const invDate = parseInvDate(inv);
    const deliveryDate = invDate ? fmtShortDate(addDays(invDate, 1)) : '—';
    const dueDate = invDate ? fmtShortDate(addDays(invDate, 30)) : '—';
    const deliveryOrder = 'DO-' + inv.id.replace(/^INV-/, '');

    const headerHtml = !showHeader ? '' : `
      <div class="letterhead-row">
        <div>
          <div class="doc-category">${sup.category}</div>
          <div class="letterhead">${inv.supplier || 'Unknown supplier'}</div>
        </div>
        <div class="doctype">Tax invoice${inv.source==='peppol' ? ' · via PEPPOL' : ''}</div>
      </div>
      ${sup.addr ? `<div class="doc-supaddr">${sup.addr}${sup.abn ? ' · ABN ' + sup.abn : ''}</div>` : ''}
      <div class="docmeta-grid">
        <div><span>Invoice No.</span><b>${(inv.rawReference || inv.id).replace('INV-','#')}</b></div>
        <div><span>Invoice Date</span><b>${invDate ? fmtShortDate(invDate) : inv.date}</b></div>
        <div><span>Delivery Date</span><b>${deliveryDate}</b></div>
        <div><span>PO Reference</span><b>${inv.po || '—'}</b></div>
        <div><span>Delivery Order</span><b>${deliveryOrder}</b></div>
        <div><span>Payment Terms</span><b>Net 30 Days</b></div>
        <div><span>Due Date</span><b>${dueDate}</b></div>
      </div>
      <div class="doc-parties">
        <div><span>Bill To</span><b>${BUYER_INFO.name}</b></div>
        <div><span>Deliver To</span><b>${inv.outlet || '—'}</b>${out.addr ? `<div class="doc-addrline">${out.addr}</div>` : ''}${out.window ? `<div class="doc-addrline">Delivery window: ${out.window}</div>` : ''}</div>
      </div>
    `;

    const subtotal = inv.amount / 1.1, gst = inv.amount - subtotal;
    const footerHtml = !showTotal ? '' : `
      <div class="doctotals">
        <div><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
        <div><span>GST @ 10%</span><span>${fmt(gst)}</span></div>
        <div class="doctotal-final"><span>Total Due</span><span>${fmt(inv.amount)}</span></div>
      </div>
      ${sup.bank ? `<div class="doc-paynote">Bank: ${sup.bank}${sup.phone ? ' · ' + sup.phone : ''}</div>` : ''}
    `;

    return `
      ${headerHtml}
      <table>
        <thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="padding-left:10px">UOM</th><th style="text-align:right">Unit price</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${pageLines.map(l => `<tr><td>${l.name}</td><td style="text-align:right">${l.qty}</td><td style="padding-left:10px;color:#888;">${l.uom||''}</td><td style="text-align:right">${l.invPrice ? fmt(l.invPrice) : ''}</td><td style="text-align:right">${l.invPrice ? fmt(l.qty*l.invPrice) : ''}</td></tr>`).join('')}</tbody>
      </table>
      ${footerHtml}
      <div class="pagestamp">Page ${page} of ${totalPages}</div>
    `;
  }
  /* ── 3-way match summary (PO ↔ GRN ↔ Invoice) ── */
  function build3WayMatch(inv){
    if (MATCH_MODE === 'none') {
      if (inv.legible === false) return '';
      const checkLines = inv.lines.length ? inv.lines : (inv.capturedLines || []);
      if (!checkLines.length) return '';
      const unmapped = checkLines.filter(l => l.unmapped).length;
      const cls = unmapped ? 'status-risk' : 'status-info';
      const summary = unmapped
        ? `${unmapped} of ${checkLines.length} line${checkLines.length>1?'s':''} not in the market list`
        : `All ${checkLines.length} line${checkLines.length>1?'s':''} matched to a known item — price and quantity were never checked`;
      return `<div class="matchbar"><span class="status ${cls}"><span class="dot"></span>No matching</span><span class="matchbar-sum">Processed as-is — ${summary}</span></div>`;
    }
    if (!inv.po || !inv.lines || !inv.lines.length) return '';
    const twoWay = MATCH_MODE === '2way';
    let matched=0, priceIssues=0, qtyIssues=0, awaitingGrn=0, extra=0, missing=0, unmapped=0;
    inv.lines.forEach(l=>{
      // Composition issues (extra/missing/unmapped) are counted separately —
      // they're not a per-line price/qty comparison, they're "this line
      // doesn't have a counterpart to compare against at all".
      if (l.missing) { missing++; return; }
      if (l.unmapped) { unmapped++; return; }
      if (l.extra) { extra++; return; }
      const priceOk = withinPriceTolerance(l);
      // 2-way match has no GRN leg — a line either matches on price or it
      // doesn't; there's no "awaiting receipt" or "qty vs GRN" state to fall into.
      if (twoWay) { if (!priceOk) priceIssues++; else matched++; return; }
      const qtyOk = l.grn===null || withinQtyTolerance(l);
      if (l.grn===null) awaitingGrn++;
      else if (!priceOk) priceIssues++;
      else if (!qtyOk) qtyIssues++;
      else matched++;
    });
    const total = inv.lines.length;
    const compParts = [];
    if (unmapped) compParts.push(`${unmapped} not in market list`);
    if (missing) compParts.push(`${missing} missing from invoice`);
    if (extra) compParts.push(`${extra} not on PO`);
    let summary, cls;
    if (compParts.length) { summary = compParts.join(' · '); cls = unmapped ? 'status-risk' : 'status-warn'; }
    else if (!twoWay && awaitingGrn === total) { summary = `Awaiting GRN on all ${total} line${total>1?'s':''}`; cls = 'status-info'; }
    else if (priceIssues || qtyIssues) {
      const parts = [];
      if (priceIssues) parts.push(`${priceIssues} price exception${priceIssues>1?'s':''}`);
      if (qtyIssues) parts.push(`${qtyIssues} quantity exception${qtyIssues>1?'s':''}`);
      summary = `${matched} of ${total} lines match · ${parts.join(' · ')}`;
      cls = 'status-risk';
    } else { summary = `All ${total} line${total>1?'s':''} match PO${twoWay ? '' : ' and GRN'}`; cls = 'status-ok'; }
    const label = twoWay ? '2-way match' : '3-way match';
    const legs = twoWay ? 'PO ↔ Invoice' : 'PO ↔ GRN ↔ Invoice';
    return `<div class="matchbar"><span class="status ${cls}"><span class="dot"></span>${label}</span><span class="matchbar-sum">${legs} — ${summary}</span></div>`;
  }
  function renderDocMockup(inv){
    document.getElementById('d-docmock').innerHTML = buildDocMockup(inv, window._docPage);
    const totalPages = inv.pages || 1;
    const pager = document.getElementById('d-docpages');
    pager.style.display = totalPages > 1 ? 'flex' : 'none';
    if (totalPages > 1) {
      document.getElementById('d-docpagelabel').textContent = `Page ${window._docPage} of ${totalPages} — assembled from ${totalPages} captured pages`;
      document.getElementById('d-docprev').disabled = window._docPage <= 1;
      document.getElementById('d-docnext').disabled = window._docPage >= totalPages;
    }
  }
  function changeDocPage(delta){
    const inv = window._currentInv;
    if (!inv) return;
    const totalPages = inv.pages || 1;
    window._docPage = Math.min(totalPages, Math.max(1, window._docPage + delta));
    renderDocMockup(inv);
  }

  function openDetail(id, fromTab){
    const inv = INV.find(i => i.id===id);
    if (!inv) return;
    if (inv.freshCapture) { toast('Still digitizing — nothing to view or edit yet'); return; }
    if (!inv.viewed) { inv.viewed = true; renderUploadsTable(); }
    window._currentInv = inv;
    window._docPage = 1;
    renderDocMockup(inv);
    window._detailFrom = fromTab || 'needs';
    const backBtn = document.getElementById('detail-back');
    backBtn.textContent = '← Back to ' + (BACK_LABELS[window._detailFrom] || 'Invoices');
    backBtn.onclick = () => showTab(window._detailFrom);
    renderDetailPager();
    document.getElementById('d-toolbar').innerHTML = buildToolbar(inv);
    document.getElementById('d-footeractions').innerHTML = buildFooter(inv);
    document.getElementById('d-statuspill').innerHTML = inv.legible === false
      ? '<span class="status status-risk"><span class="dot"></span>Unreadable — needs a clearer capture</span>'
      : inv.duplicateOf
        ? `<span class="status status-warn"><span class="dot"></span>Possible duplicate of ${inv.duplicateOf}</span>`
        : (inv.status === 'pending' && inv.supplier && !inv.po && inv.matchAttempted !== false)
          ? '<span class="status status-neutral"><span class="dot"></span>No PO linked</span>'
          : statusPillHtml(inv);
    document.getElementById('d-files').textContent = inv.id + (inv.source==='email'?'.eml':inv.source==='peppol'?'.xml':inv.source==='photo'?'.jpg':'.pdf');
    document.getElementById('d-srcbadge').innerHTML = srcBadge(inv.source);
    document.getElementById('d-pagesbadge').innerHTML = pagesBadge(inv);
    document.getElementById('d-uploader').textContent = 'Uploaded by ' + inv.by;
    renderHistoryButton(inv);
    document.getElementById('d-supplier').innerHTML = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${supplierAvatar(inv,30)}${fieldInput(inv,'supplier','Supplier', inv.supplier || '')}</div>`;
    document.getElementById('d-outlet').innerHTML = fieldInput(inv,'outlet','Delivered to', inv.outlet || '');
    document.getElementById('d-id').innerHTML = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">${fieldInput(inv,'rawReference','Invoice number', inv.rawReference || inv.id)}<button class="btn btn-ghost" style="padding:4px 12px;font-size:12px;flex:none;" onclick="toast('Validated against supplier records')">Validate</button></div>`;
    document.getElementById('d-date').innerHTML = fieldInput(inv,'date','Invoice date', inv.date || '');
    document.getElementById('d-pohelp').style.display = (inv.legible === false || MATCH_MODE === 'none') ? 'none' : '';
    document.getElementById('d-pochips').innerHTML = inv.legible === false
      ? `<span style="color:var(--text-soft);font-size:13px;">Not applicable — resolve the image issue above before this can be matched</span>`
      : MATCH_MODE === 'none'
        ? `<span style="color:var(--text-soft);font-size:13px;">Not required — matching is off</span>`
        : inv.po
          ? renderLinkedPO(inv)
          : renderPOInput(inv);
    document.getElementById('d-matchbar').innerHTML = build3WayMatch(inv);
    document.getElementById('d-grnfield').innerHTML = grnFieldHtml(inv);
    document.querySelector('.linetable').classList.toggle('hide-grn', MATCH_MODE === '2way' || MATCH_MODE === 'none');
    document.querySelector('.linetable').classList.toggle('hide-poprice', MATCH_MODE === 'none');
    // 'none' mode: no PO means `lines` (the PO-matching working set) is
    // never populated the normal way — fall back to `capturedLines` (what
    // the document actually shows) so there's still something to display,
    // same source computeOutcome()/runChecks() already check for unmapped
    // items in this mode.
    const displayLines = MATCH_MODE === 'none' && !inv.lines.length ? (inv.capturedLines || []) : inv.lines;
    document.getElementById('d-lines').innerHTML = displayLines.length ? displayLines.map((l, idx) => {
      if (MATCH_MODE === 'none') {
        // Read-only, not editable like the 3-way/2-way rows below: when the
        // row is sourced from capturedLines (no PO ever linked), there's no
        // inv.lines[idx] for commitLineEdit() to write back to, and editing
        // "into" a fake PO-match context that doesn't exist would be
        // misleading anyway — this is a what-was-captured view, not a
        // working set.
        const statusHtml = l.unmapped
          ? '<span class="status status-risk"><span class="dot"></span>Unmapped item</span>'
          : '<span class="status status-info"><span class="dot"></span>Not checked</span>';
        const qty = l.qty ?? 0, price = l.invPrice ?? 0;
        return `<tr>
          <td class="drag">⠿</td>
          <td>${escapeHtml(l.name)}<div class="li-sku">${l.sku||''}</div></td>
          <td>${qty}</td>
          <td class="c-grn-cell li-ref">—</td>
          <td>${escapeHtml(l.uom||'—')}</td>
          <td>${fmt(price)}</td>
          <td class="li-ref c-popr-cell">—</td>
          <td>—</td>
          <td>—</td>
          <td class="li-amt">${fmt(qty*price)}</td>
          <td>${statusHtml}</td>
          <td></td>
        </tr>`;
      }
      // A "missing" line is a placeholder for a PO item the invoice never
      // billed at all — there's nothing captured to edit, so it renders as
      // an informational row instead of going through the normal
      // match/edit logic below (which assumes a real invoiced qty/price).
      if (l.missing) {
        return `<tr class="li-row-missing">
          <td class="drag">⠿</td>
          <td><span class="li-missing-name">${escapeHtml(l.name)}</span><div class="li-sku">${l.sku||''} · expected ${l.qty} ${l.uom||''} @ ${fmt(l.poPrice)}</div></td>
          <td>—</td><td class="c-grn-cell li-ref">—</td><td>—</td><td>—</td>
          <td class="li-ref c-popr-cell">${fmt(l.poPrice)}</td>
          <td>—</td><td>—</td>
          <td class="li-amt">—</td>
          <td><span class="status status-warn"><span class="dot"></span>Not invoiced</span></td>
          <td></td>
        </tr>`;
      }
      const twoWay = MATCH_MODE === '2way';
      const qtyOk = twoWay || l.grn===null || withinQtyTolerance(l);
      const priceOk = (l.extra || l.unmapped) ? true : withinPriceTolerance(l);
      let statusHtml;
      if (l.unmapped) { statusHtml = '<span class="status status-risk"><span class="dot"></span>Unmapped item</span>'; }
      else if (l.extra) { statusHtml = `<span class="status status-warn"><span class="dot"></span>Not on ${inv.po}</span>`; }
      else if (!twoWay && l.grn===null) { statusHtml = '<span class="status status-info"><span class="dot"></span>Awaiting GRN</span>'; }
      else if (!priceOk && !qtyOk) {
        // A line can fail both checks at once — show one pill per issue
        // rather than letting price silently win and hide the qty problem
        // the GRN column shows.
        const pricePill = `<span class="status status-risk"><span class="dot"></span>${(((l.invPrice-l.poPrice)/l.poPrice)*100).toFixed(1)}% vs PO</span>`;
        const qtyPill = `<span class="status status-warn"><span class="dot"></span>Qty ${l.qty>l.grn?'+':''}${l.qty-l.grn} vs GRN</span>`;
        statusHtml = `<div class="status-stack">${pricePill}${qtyPill}</div>`;
      }
      else if (!priceOk) { statusHtml = `<span class="status status-risk"><span class="dot"></span>${(((l.invPrice-l.poPrice)/l.poPrice)*100).toFixed(1)}% vs PO</span>`; }
      else if (!qtyOk) { statusHtml = `<span class="status status-warn"><span class="dot"></span>Qty ${l.qty>l.grn?'+':''}${l.qty-l.grn} vs GRN</span>`; }
      else { statusHtml = '<span class="status status-ok"><span class="dot"></span>Matches PO</span>'; }
      // Reference cells: the GRN's received qty and the PO's agreed price, sat
      // beside the invoiced figures so the variance is readable inline rather
      // than only in the Match pill. An extra/unmapped line has neither.
      const grnCell = (l.extra || l.unmapped) ? '<span title="Not on the goods receipt">—</span>'
        : l.grn === null ? '<span title="Not received yet">—</span>' : String(l.grn);
      const poCell = (l.extra || l.unmapped) ? '<span title="Not on the purchase order">—</span>' : fmt(l.poPrice);
      const editedTag = l.edited ? ' <span class="li-edited" title="Corrected by a person — see History">·edited</span>' : '';
      return `<tr>
        <td class="drag">⠿</td>
        <td><input class="li-input" value="${escapeHtml(l.name)}" onchange="commitLineEdit('${inv.id}',${idx},'name','Description',this.value)"/><div class="li-sku">${l.sku||''}${editedTag}</div></td>
        <td><input class="li-input num" value="${l.qty}" onchange="commitLineEdit('${inv.id}',${idx},'qty','Qty',this.value)"/></td>
        <td class="c-grn-cell li-ref${qtyOk ? '' : ' ref-warn'}">${grnCell}</td>
        <td><input class="li-input" value="${escapeHtml(l.uom||'')}" onchange="commitLineEdit('${inv.id}',${idx},'uom','Unit size',this.value)"/></td>
        <td><input class="li-input num" value="${l.invPrice.toFixed(2)}" onchange="commitLineEdit('${inv.id}',${idx},'invPrice','Unit price',this.value)"/></td>
        <td class="li-ref c-popr-cell${priceOk ? '' : ' ref-off'}">${poCell}</td>
        <td><input class="li-input num" value="0"/></td>
        <td><input class="li-input num" value="10"/></td>
        <td class="li-amt">${fmt(l.qty*l.invPrice)}</td>
        <td>${statusHtml}</td>
        <td class="rowdel" onclick="toast('Line removed')">✕</td>
      </tr>`;
    }).join('') : `<tr><td colspan="12" style="text-align:center;color:var(--text-soft);font-style:italic;padding:14px 0;">${inv.legible === false ? 'No line items — the document could not be read' : MATCH_MODE === 'none' ? 'No line items were captured on this document' : 'No PO linked yet — line items unavailable until this is matched'}</td></tr>`;

    const marginCard = document.getElementById('d-margincard');
    if (inv.margin) {
      document.getElementById('d-marginhead').textContent = inv.margin.headline;
      document.getElementById('d-marginsub').textContent = inv.margin.sub;
      marginCard.style.display = '';
    } else { marginCard.style.display = 'none'; }

    const delivery = inv.deliveryFee || 0, discount = inv.discount || 0;
    const subtotal = inv.amount/1.1, gst = inv.amount-subtotal;
    document.getElementById('d-subtotal').textContent = fmt(subtotal);
    document.getElementById('d-delivery').textContent = fmt(delivery);
    document.getElementById('d-discount').textContent = discount ? '−' + fmt(discount) : fmt(0);
    document.getElementById('d-gst').textContent = fmt(gst);
    document.getElementById('d-total').textContent = fmt(inv.amount);

    setQueueChromeVisible(false);
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
    document.getElementById('v-detail').classList.add('on');
    document.getElementById('page-title').textContent = 'Invoice detail';
    window.scrollTo({top:0,behavior:'smooth'});
  }

  /* ── Bulk resolution in Needs your input ───────────────────────────────
     BULK_RESOLUTIONS and NEEDS_SELECTION are declared up top with the
     other module-level config — renderNeedsTab() reads them during the
     eager refreshAllTables() call, which runs before this point in the
     file. ── */
  function needsSelectionState(){
    const shown = applyListCtl(getNeeds(), 'needs');
    const selected = shown.filter(i => NEEDS_SELECTION.has(i.id));
    const reasons = Array.from(new Set(selected.map(i => i.reasonTag)));
    return { shown, selected, reasons, resolution: reasons.length === 1 ? BULK_RESOLUTIONS[reasons[0]] : null };
  }

  function updateNeedsSelection(){
    const { shown, selected, reasons, resolution } = needsSelectionState();
    const all  = document.getElementById('needs-select-all');
    const btn  = document.getElementById('bulk-approve-btn');
    const note = document.getElementById('bulk-note');
    if (all) {
      all.checked = shown.length > 0 && selected.length === shown.length;
      all.indeterminate = selected.length > 0 && selected.length < shown.length;
    }
    if (!btn || !note) return;
    if (!selected.length) {
      btn.disabled = true; btn.textContent = 'Approve selected (0)'; note.textContent = '';
    } else if (reasons.length > 1) {
      btn.disabled = true; btn.textContent = `${selected.length} selected`;
      note.textContent = `Mixed reasons (${reasons.join(', ')}) — each needs a different resolution. Filter to one reason to act in bulk.`;
    } else if (!resolution) {
      btn.disabled = true; btn.textContent = `${selected.length} selected`;
      note.textContent = `“${reasons[0]}” needs a per-invoice decision — open each one to resolve it.`;
    } else {
      btn.disabled = false; btn.textContent = resolution.label(selected.length);
      const impact = selected.reduce((s,i) => s + exceptionCaughtAmount(i), 0);
      note.textContent = impact > 0 ? `${fmt(impact)} of variance across ${selected.length} invoice${selected.length>1?'s':''}` : '';
    }
  }

  function toggleNeedsCheck(id, checked){
    if (checked) NEEDS_SELECTION.add(id); else NEEDS_SELECTION.delete(id);
    updateNeedsSelection();
  }
  function toggleSelectAllNeeds(checked){
    needsSelectionState().shown.forEach(i => checked ? NEEDS_SELECTION.add(i.id) : NEEDS_SELECTION.delete(i.id));
    renderNeedsTab();
  }

  function openBulkApproveModal(){
    const { selected, reasons, resolution } = needsSelectionState();
    if (!selected.length || !resolution) return;
    const total  = selected.reduce((s,i) => s + i.amount, 0);
    const impact = selected.reduce((s,i) => s + exceptionCaughtAmount(i), 0);
    document.getElementById('bulk-modal-title').textContent = resolution.label(selected.length) + '?';
    document.getElementById('bulk-modal-body').innerHTML =
      `${selected.length} invoice${selected.length>1?'s':''} totalling <b>${fmt(total)}</b>, all flagged <b>${reasons[0]}</b>` +
      (impact > 0 ? `, carrying <b>${fmt(impact)}</b> of variance against the PO` : '') + '.';
    document.getElementById('bulk-modal-warn').textContent = resolution.warn;
    document.getElementById('bulk-modal-confirm').textContent = resolution.label(selected.length);
    document.getElementById('modal').classList.add('on');
  }
  function closeModal(){ document.getElementById('modal').classList.remove('on'); }
  function confirmBulkApprove(){
    const { selected, resolution } = needsSelectionState();
    if (!selected.length || !resolution) return;
    // Resolved in place rather than through approveInvoice() per invoice:
    // that routes through transitionInvoice(), which navigates back to a
    // tab and toasts on every call — it would bounce the user out of the
    // queue mid-batch and fire one toast per invoice.
    selected.forEach(inv => { inv.status = 'approved'; inv.resolutionNote = resolution.note; });
    const n = selected.length;
    NEEDS_SELECTION.clear();
    closeModal();
    refreshAllTables();
    toast(`${n} invoice${n>1?'s':''} resolved — ${resolution.note.toLowerCase()}`);
  }

  /* ── Matching settings — org-wide policy, not a per-invoice toggle. Opens
     pre-selected to the mode currently in effect; nothing changes until
     Save, at which point every invoice not already approved/exported is
     re-evaluated against the new policy (see refreshAllTables()). ── */
  function renderMatchModeButton(){
    document.getElementById('match-settings-btn').innerHTML = '<i class="ti ti-adjustments-horizontal"></i> Matching: ' + MATCH_MODE_LABEL[MATCH_MODE];
  }
  function previewMatchMode(mode){
    document.getElementById('opt-3way').classList.toggle('sel', mode==='3way');
    document.getElementById('opt-2way').classList.toggle('sel', mode==='2way');
    document.getElementById('opt-none').classList.toggle('sel', mode==='none');
    document.getElementById('settings-2way-note').style.display = mode==='2way' ? 'flex' : 'none';
    document.getElementById('settings-none-note').style.display = mode==='none' ? 'flex' : 'none';
  }
  function openSettingsModal(){
    document.querySelector(`input[name="matchmode"][value="${MATCH_MODE}"]`).checked = true;
    previewMatchMode(MATCH_MODE);
    document.getElementById('settings-modal').classList.add('on');
  }
  function closeSettingsModal(){ document.getElementById('settings-modal').classList.remove('on'); }
  function saveMatchSettings(){
    const chosen = document.querySelector('input[name="matchmode"]:checked').value;
    const changed = chosen !== MATCH_MODE;
    MATCH_MODE = chosen;
    closeSettingsModal();
    renderMatchModeButton();
    if (!changed) return;
    refreshAllTables();
    // If an invoice is open in the detail screen, its checklist/matchbar/
    // line statuses are computed inline in openDetail() rather than pulled
    // from a store — re-render it so it reflects the new policy too.
    if (document.getElementById('v-detail').classList.contains('on') && window._currentInv) {
      openDetail(window._currentInv.id, window._detailFrom);
    }
    toast(chosen === 'none' ? 'Matching turned off — invoices re-evaluated' : chosen === '2way' ? 'Switched to 2-way match — invoices re-evaluated' : 'Switched to 3-way match — invoices re-evaluated');
  }

  /* ── Tolerance settings — org-wide policy, same status as matching mode:
     not a per-invoice control. Opens pre-filled with the values currently
     in effect; nothing changes until Save, at which point every invoice
     not already approved/exported is re-evaluated against the new
     tolerance (see refreshAllTables()). ── */
  function renderToleranceCopy(){
    const bulk = document.getElementById('tol-bulkbar-copy');
    if (bulk) bulk.textContent = `±${PRICE_TOLERANCE_PCT}% price · ±${QTY_TOLERANCE_PCT}% qty`;
  }
  function openToleranceModal(){
    document.getElementById('tol-price-input').value = PRICE_TOLERANCE_PCT;
    document.getElementById('tol-qty-input').value = QTY_TOLERANCE_PCT;
    document.getElementById('tolerance-modal').classList.add('on');
  }
  function closeToleranceModal(){ document.getElementById('tolerance-modal').classList.remove('on'); }
  function saveToleranceSettings(){
    const priceInput = document.getElementById('tol-price-input');
    const qtyInput = document.getElementById('tol-qty-input');
    // Clamp rather than reject — a stray blank/negative entry shouldn't
    // block the save, just fall back to a sane bound.
    const newPrice = Math.min(100, Math.max(0, parseFloat(priceInput.value) || 0));
    const newQty   = Math.min(100, Math.max(0, parseFloat(qtyInput.value) || 0));
    const changed = newPrice !== PRICE_TOLERANCE_PCT || newQty !== QTY_TOLERANCE_PCT;
    PRICE_TOLERANCE_PCT = newPrice;
    QTY_TOLERANCE_PCT = newQty;
    closeToleranceModal();
    renderToleranceCopy();
    if (!changed) return;
    refreshAllTables();
    // If an invoice is open in the detail screen, its checklist/matchbar/
    // line statuses are computed inline in openDetail() rather than pulled
    // from a store — re-render it so it reflects the new policy too.
    if (document.getElementById('v-detail').classList.contains('on') && window._currentInv) {
      openDetail(window._currentInv.id, window._detailFrom);
    }
    toast(`Tolerance updated to ±${PRICE_TOLERANCE_PCT}% price · ±${QTY_TOLERANCE_PCT}% qty — invoices re-evaluated`);
  }

  /* ── Date range — scopes the stat row and every list to a window of
     invoice dates. Same shape as Matching/Tolerance settings (org-wide,
     explicit Save/Apply, re-evaluates the queue), but reversible per
     visit rather than a standing policy — so it defaults back to "All
     time" on reload rather than persisting like MATCH_MODE would. ── */
  function fmtShortDate(d){ return d.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}); }
  function renderDateRangeCopy(){
    const btn = document.getElementById('daterange-btn');
    if (btn) btn.innerHTML = '<i class="ti ti-calendar"></i> ' + DR_PRESET_LABEL[DATE_RANGE.preset];
    const scope = document.getElementById('statrow-scope');
    if (!scope) return;
    scope.textContent = DATE_RANGE.preset === 'all'
      ? 'Stats above cover every invoice, all time.'
      : `Stats above cover ${fmtShortDate(DATE_RANGE.from)} – ${fmtShortDate(DATE_RANGE.to)} (${DR_PRESET_LABEL[DATE_RANGE.preset].toLowerCase()}).`;
  }
  function previewDateRange(preset){
    document.getElementById('dr-custom-row').style.display = preset === 'custom' ? 'flex' : 'none';
  }
  // Deliberately not toISOString() — that converts to UTC first, which can
  // shift the calendar day backward/forward depending on the browser's
  // timezone offset from the local Date these presets are built from.
  function toDateInputValue(d){
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function openDateRangeModal(){
    document.querySelector(`input[name="drpreset"][value="${DATE_RANGE.preset}"]`).checked = true;
    previewDateRange(DATE_RANGE.preset);
    document.getElementById('dr-from-input').value = DATE_RANGE.from ? toDateInputValue(DATE_RANGE.from) : toDateInputValue(daysBefore(LATEST_SEED_DATE,6));
    document.getElementById('dr-to-input').value = DATE_RANGE.to ? toDateInputValue(DATE_RANGE.to) : toDateInputValue(LATEST_SEED_DATE);
    document.getElementById('daterange-modal').classList.add('on');
  }
  function closeDateRangeModal(){ document.getElementById('daterange-modal').classList.remove('on'); }
  function saveDateRange(){
    const preset = document.querySelector('input[name="drpreset"]:checked').value;
    const prevPreset = DATE_RANGE.preset, prevFrom = DATE_RANGE.from, prevTo = DATE_RANGE.to;
    if (preset === 'custom') {
      const fromVal = document.getElementById('dr-from-input').value;
      const toVal = document.getElementById('dr-to-input').value;
      // Missing either bound isn't an error here — an open-ended custom
      // range (e.g. "everything from 10 June onward") is a reasonable
      // thing to want, not a form that failed validation.
      const from = fromVal ? startOfDay(new Date(fromVal + 'T00:00:00')) : null;
      const to = toVal ? endOfDay(new Date(toVal + 'T00:00:00')) : null;
      DATE_RANGE = { preset:'custom', from, to };
    } else {
      applyDateRangePreset(preset);
    }
    closeDateRangeModal();
    renderDateRangeCopy();
    const changed = DATE_RANGE.preset !== prevPreset || +DATE_RANGE.from !== +prevFrom || +DATE_RANGE.to !== +prevTo;
    if (!changed) return;
    refreshAllTables();
    toast(`Date range set to ${DR_PRESET_LABEL[DATE_RANGE.preset].toLowerCase()} — lists and stats updated`);
  }
  function toast(msg){
    const el = document.createElement('div');
    el.style.cssText = 'background:var(--seaweed);color:#fff;padding:10px 20px;border-radius:999px;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.18);pointer-events:none;white-space:nowrap;max-width:460px;text-align:center;';
    el.textContent = msg;
    document.getElementById('toast-wrap').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  /* ══════════ status transitions — move an invoice between pipeline stages ══════════
     Every action below mutates inv.status (or removes the invoice), re-renders all
     three tabs, and returns to the tab the user opened the detail view from — so the
     item visibly leaves that list as its stage changes. */
  function findInv(id){ return INV.find(i => i.id === id); }
  function transitionInvoice(id, newStatus, msg, extra){
    const inv = findInv(id);
    if (!inv) return;
    Object.assign(inv, {status:newStatus}, extra||{});
    toast(msg);
    refreshAllTables();
    showTab(window._detailFrom || 'uploads');
  }
  function removeInvoice(id, msg){
    const idx = INV.findIndex(i => i.id === id);
    if (idx > -1) INV.splice(idx,1);
    toast(msg);
    refreshAllTables();
    showTab(window._detailFrom || 'uploads');
  }
  // Callers that resolve an exception pass a sentence describing HOW it was
  // resolved ("Credit note drafted…", "Accepted as short-shipped…"); keep it
  // on the invoice so Processed can show what was actually decided, not just
  // that someone clicked approve. A plain clean-match approval passes no
  // message and gets no note.
  function approveInvoice(id, msg){
    transitionInvoice(id, 'approved', msg || 'Approved — ready to export', msg ? { resolutionNote: msg } : null);
  }
  function exportInvoice(id){ transitionInvoice(id, 'exported', `Exported to ${ACCOUNTING_SYSTEM}`, {exportedTo: ACCOUNTING_SYSTEM}); }
  function discardInvoice(id){ removeInvoice(id, 'Discarded'); }
  function rejectUpload(id){ removeInvoice(id, 'Upload rejected'); }
  // open = not already attached to a different invoice, and (when the invoice's
  // supplier is known) belonging to that same supplier — the two things that
  // make a PO a *plausible* pick, before a person even starts typing.
  function poCandidatesFor(inv){
    const used = new Set(INV.filter(i => i.id !== inv.id && i.po).map(i => i.po));
    return PO_CATALOG.filter(p => !used.has(p.po) && (!inv.supplier || p.supplier === inv.supplier));
  }
  function findPO(code){ return PO_CATALOG.find(p => p.po.toLowerCase() === (code||'').trim().toLowerCase()); }

  function renderPOSuggest(id){
    const inv = findInv(id);
    const input = document.getElementById('po-link-input');
    const box = document.getElementById('po-suggest');
    if (!inv || !input || !box) return;
    const q = input.value.trim().toLowerCase();
    const candidates = poCandidatesFor(inv).filter(p => !q || p.po.toLowerCase().includes(q));
    box.innerHTML = candidates.length
      ? candidates.map(p => `<div class="po-suggest-item" onmousedown="event.preventDefault();selectPO('${p.po}')"><span class="n">${p.po}</span><span class="d">${p.poDate} · ${fmt(p.amount)}</span></div>`).join('')
      : `<div class="po-suggest-empty">No open PO${q ? ` matching "${input.value.trim()}"` : ''} for ${inv.supplier || 'this supplier'}</div>`;
    box.style.display = 'block';
  }
  function selectPO(po){
    const input = document.getElementById('po-link-input');
    if (input) input.value = po;
    hidePOSuggest();
    clearPOError();
  }
  function hidePOSuggest(){ const box = document.getElementById('po-suggest'); if (box) box.style.display = 'none'; }
  function clearPOError(){
    const err = document.getElementById('po-error'), input = document.getElementById('po-link-input');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    if (input) input.classList.remove('invalid');
  }
  function showPOError(msg){
    const err = document.getElementById('po-error'), input = document.getElementById('po-link-input');
    if (err) { err.style.display = ''; err.textContent = msg; }
    if (input) input.classList.add('invalid');
  }
  // Close the suggestion list on any click outside the field — registered once,
  // not per-render, since the field itself gets re-rendered on every keystroke.
  document.addEventListener('click', e => { if (!e.target.closest('#po-field-wrap')) hidePOSuggest(); });

  function renderLinkedPO(inv){
    const editable = !['approved','exported'].includes(inv.status);
    return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span class="pochip"><span class="n">${inv.po}</span><span class="d">${inv.poDate} · ${fmt(inv.amount)}</span></span>
      ${editable ? `<button class="btn-text" style="font-size:12px;" onclick="editPO('${inv.id}')">Change</button>` : ''}
    </div>`;
  }
  function renderPOInput(inv){
    const example = (poCandidatesFor(inv)[0] || {}).po || 'PO-5512';
    return `<div class="pofield" id="po-field-wrap">
      <div style="position:relative;">
        <input id="po-link-input" class="li-input" autocomplete="off" placeholder="Type a PO number — e.g. ${example}" style="height:38px;"
          oninput="renderPOSuggest('${inv.id}')" onfocus="renderPOSuggest('${inv.id}')"
          onkeydown="if(event.key==='Enter'){event.preventDefault();linkPO('${inv.id}');}if(event.key==='Escape'){hidePOSuggest();}" />
        <div class="po-suggest" id="po-suggest"></div>
      </div>
      <div class="po-error" id="po-error" style="display:none;"></div>
      <button class="btn btn-go" style="height:36px;padding:0 14px;margin-top:8px;" onclick="linkPO('${inv.id}')">Link PO</button>
    </div>`;
  }
  function editPO(id){
    const inv = findInv(id);
    if (!inv) return;
    document.getElementById('d-pochips').innerHTML = renderPOInput(inv);
    document.getElementById('po-link-input').focus();
  }

  /* Linking a PO doesn't just attach a number — it's what lets the match run at
     all. Once it's set, the same computeOutcome() pipeline that evaluates every
     other invoice picks this one up and resolves it on its own merits: straight
     to 'ok' when the PO and GRN line up, into 'risk'/'warn' when they don't, or
     still 'pending' if the goods receipt hasn't landed yet. No separate agent
     name or step — it's the same background matching every invoice already
     goes through, just unblocked now that a PO exists.

     Unlike Approve/Export/Discard (which finish a person's business with an
     invoice and rightly send them back to the list), linking a PO is the start
     of a new automated step on the SAME invoice — so this stays on the detail
     screen instead of navigating away. It shows the in-between "matching" state
     first, then re-renders this same screen with whatever the match decided,
     so the result is visible immediately instead of requiring a trip to go
     find where the invoice landed. */
  function linkOutcomeMessage(inv){
    if (inv.status === 'ok') return 'Matched cleanly against PO and GRN — ready to auto-post';
    if (inv.status === 'risk' || inv.status === 'warn') return 'Matched — flagged for review, see below';
    return 'PO linked — still waiting on goods receipt';
  }
  function linkPO(id){
    const inv = findInv(id);
    if (!inv) return;
    const input = document.getElementById('po-link-input');
    const raw = (input && input.value.trim()) || '';

    // Validate before anything else runs — only a real, open, same-supplier
    // PO that isn't already spoken for gets past here.
    if (!raw) { showPOError('Enter or select a PO number'); return; }
    const match = findPO(raw);
    if (!match) { showPOError(`${raw} isn't a recognized PO number — pick one from the list`); return; }
    if (inv.supplier && match.supplier !== inv.supplier) { showPOError(`${match.po} belongs to ${match.supplier}, not ${inv.supplier}`); return; }
    const clash = INV.find(i => i.id !== inv.id && i.po === match.po);
    if (clash) { showPOError(`${match.po} is already linked to ${clash.id}`); return; }
    clearPOError();
    hidePOSuggest();

    // Step 1 — nothing fetched yet: show the linked number and an in-progress
    // state right where the person was just typing, not a separate screen.
    document.getElementById('d-pochips').innerHTML =
      `<span style="display:inline-flex;align-items:center;gap:8px;color:var(--text-soft);font-size:13px;"><span class="spinner"></span>Matching ${match.po} against goods receipt…</span>`;
    document.getElementById('d-statuspill').innerHTML = '<span class="status status-info"><span class="dot"></span>Matching…</span>';
    document.getElementById('d-toolbar').innerHTML = '<span style="color:#9FA89F;font-size:12px;align-self:center;">Matching…</span>';
    document.getElementById('d-footeractions').innerHTML = '';
    document.getElementById('d-matchbar').innerHTML =
      `<div class="matchbar"><span class="status status-info"><span class="dot"></span>3-way match</span><span class="matchbar-sum">Pulling PO and goods-receipt data…</span></div>`;

    // Step 2 — the actual lookup/match; the short delay stands in for the real
    // round trip to the PO and GRN systems.
    setTimeout(() => {
      const extra = { po: match.po, poDate: match.poDate, matchAttempted: true };
      if (!inv.lines || !inv.lines.length) extra.lines = match.lines.map(l => ({ ...l, invPrice: l.poPrice }));
      Object.assign(inv, extra);
      refreshAllTables(); // resolves inv.status and keeps Uploads/Needs/Processed in sync in the background
      toast(linkOutcomeMessage(inv));
      // Step 3 — land back on THIS invoice, now showing whatever the match
      // decided, instead of a list tab the person has to search through.
      openDetail(inv.id, window._detailFrom);
    }, 700);
  }
  function continueNotDuplicate(id){ transitionInvoice(id, 'ok', 'Confirmed as unique — matched cleanly against PO and GRN', { duplicateOf: null }); }
  function continueNotDuplicate(id){ transitionInvoice(id, 'ok', 'Confirmed as unique — matched cleanly against PO and GRN', { duplicateOf: null }); }

  /* ══════════ delete an upload — guardrailed, not a plain remove ══════════
     Only reachable while an invoice is still pending (never once it's an
     approved/exported financial record); requires a reason for the audit
     log; warns if a PO is already linked so deleting doesn't orphan it. */
  function openDeleteModal(id){
    const inv = findInv(id);
    if (!inv) return;
    if (inv.status === 'approved' || inv.status === 'exported') {
      toast('Can\'t delete — this has already been approved. Use a credit note instead.');
      return;
    }
    window._deleteTargetId = id;
    document.getElementById('del-summary').innerHTML =
      `<strong>${inv.id}</strong> — ${inv.supplier || 'Unknown supplier'}${inv.amount ? ' · ' + fmt(inv.amount) : ''}`;
    const warn = document.getElementById('del-warning');
    if (inv.po) {
      warn.style.display = '';
      warn.innerHTML = `<i class="ti ti-alert-triangle"></i> Already linked to ${inv.po} — deleting it won't remove that PO, just this invoice.`;
    } else {
      warn.style.display = 'none';
    }
    document.getElementById('del-reason').value = '';
    document.getElementById('del-confirm-btn').disabled = true;
    document.getElementById('delete-modal').classList.add('on');
  }
  function closeDeleteModal(){
    document.getElementById('delete-modal').classList.remove('on');
    window._deleteTargetId = null;
  }
  function confirmDeleteInvoice(){
    const id = window._deleteTargetId;
    const reason = document.getElementById('del-reason').value;
    if (!id || !reason) return;
    const idx = INV.findIndex(i => i.id === id);
    if (idx > -1) INV.splice(idx,1);
    closeDeleteModal();
    toast(`Deleted ${id} — ${reason}`);
    refreshAllTables();
    showTab('uploads'); // pending invoices only ever live in Uploads — always safe to land back there
  }
  document.getElementById('del-reason').addEventListener('change', function(){
    document.getElementById('del-confirm-btn').disabled = !this.value;
  });

  /* ══════════ upload invoice modal — matches the real product's simple
     modal interaction (not a multi-step wizard); fixes layered on top:
     raised size cap + explicit multi-page capture. ══════════ */
  let pages = [];

  function openUploadModal(){
    pages = [];
    document.getElementById('outlet').value = '';
    document.getElementById('filein').value = '';
    renderPages();
    document.getElementById('upload-modal').classList.add('on');
  }
  function closeUploadModal(){
    document.getElementById('upload-modal').classList.remove('on');
  }

  const zone = document.getElementById('zone');
  const filein = document.getElementById('filein');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) addPage(f);
  });
  filein.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) addPage(f);
    e.target.value = '';
  });
  document.getElementById('addPageBtn').addEventListener('click', () => filein.click());

  function addPage(file){
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    pages.push({ name: file.name, isPdf, mb: (file.size/1024/1024).toFixed(1) });
    renderPages();
  }
  function removePage(i){ pages.splice(i,1); renderPages(); }

  function renderPages(){
    document.getElementById('pagesWrap').style.display = pages.length ? '' : 'none';
    document.getElementById('pageCount').textContent = pages.length;
    document.getElementById('pageList').innerHTML = pages.map((p,i) => `
      <div class="pageitem">
        <span class="ic">${p.isPdf ? '<i class="ti ti-file-text"></i>' : '<i class="ti ti-photo"></i>'}</span>
        <span class="nm">Page ${i+1} · ${p.name}</span>
        <span class="sz">${p.mb} MB</span>
        <button class="rm" onclick="removePage(${i})">✕</button>
      </div>`).join('');
    document.getElementById('zoneLabel').textContent = pages.length ? 'Drop another page here, or click to browse' : 'Drag and drop files here or click to upload';
  }

  function finishUpload(){
    const outlet = document.getElementById('outlet').value;
    if (!outlet) { toast('Select an outlet first'); return; }
    if (!pages.length) { toast('Add at least one page'); return; }
    const seq = 950 + Math.floor(Math.random()*49); // clear of every seeded id (900-904, 876-897)
    const now = new Date();
    const newInv = {
      id: 'INV-00' + seq, po: null, poDate: null, supplier: 'Unrecognized supplier', outlet,
      date: now.toLocaleDateString('en-AU',{day:'numeric',month:'long'}) + ', ' + now.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:false}),
      source: pages.some(p=>p.isPdf) ? 'upload' : 'photo', amount: 0, status: 'pending', by: 'Keith Tan',
      freshCapture: true, viewed: false, lines: [],
    };
    INV.unshift(newInv);
    renderUploadsTable();
    closeUploadModal();
    toast('✓ Successfully uploaded');
  }
