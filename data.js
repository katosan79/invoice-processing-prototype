// Mock data for the Invoice Review prototype.
// INV: the seeded invoices shown across Uploads / Needs your input / Processed.
// PO_CATALOG: the open POs available to link an unmatched invoice against.
// Swap or extend either array to try new scenarios without touching app.js.

  const INV = [
    { id:'INV-00895', po:'PO-5515', poDate:'12 June 2026', supplier:'Sydney Butchers Co.', outlet:'Bondi Beach', date:'12 June, 09:40', source:'email', amount:209.0, status:'pending', by:'Keith Tan', viewed:true,
      lines:[{name:'Chicken Thigh 2kg',sku:'CHK-THI-2KG',uom:'pkg',poPrice:11.50,invPrice:11.50,qty:8,grn:null},{name:'Beef Mince 500g',sku:'BEEF-MIN-500',uom:'pkg',poPrice:9.80,invPrice:9.80,qty:10,grn:null}] },
    { id:'INV-00892', grnRef:'GRN-3401', po:'PO-5519', poDate:'11 June 2026', supplier:'Green Farmers Market', outlet:'Newtown', date:'11 June, 14:12', source:'upload', amount:932.58, status:'pending', by:'Idayu', pages:3, viewed:false,
      lines:[
        {name:'Mixed Leaf 2kg',sku:'GFM-MXL-2KG',uom:'bag',poPrice:9.00,invPrice:9.00,qty:12,grn:12},
        {name:'Roma Tomatoes 5kg',sku:'GFM-TOM-5KG',uom:'box',poPrice:16.50,invPrice:16.50,qty:20,grn:20},
        {name:'Baby Spinach 1kg',sku:'GFM-SPN-1KG',uom:'bag',poPrice:12.00,invPrice:12.00,qty:15,grn:15},
        {name:'Cherry Tomatoes 250g',sku:'GFM-CHT-250',uom:'punnet',poPrice:3.50,invPrice:3.50,qty:30,grn:null},
        {name:'Avocado (each)',sku:'GFM-AVO-EA',uom:'ea',poPrice:2.40,invPrice:2.40,qty:40,grn:null},
        {name:'Cucumber (each)',sku:'GFM-CUC-EA',uom:'ea',poPrice:1.20,invPrice:1.20,qty:24,grn:null},
      ] },
    { id:'INV-00900', po:null, poDate:null, matchAttempted:false, supplier:'Fresh Produce Co', outlet:'Melbourne CBD', date:'13 June, 08:15', source:'upload', amount:327.8, status:'pending', by:'Waihong Chee', viewed:false,
      lines:[{name:'Cherry Tomatoes 250g',sku:'FPC-CHT-250',uom:'punnet',poPrice:3.50,invPrice:3.50,qty:60,grn:null},{name:'Iceberg Lettuce (each)',sku:'FPC-ICE-EA',uom:'ea',poPrice:2.20,invPrice:2.20,qty:40,grn:null}] },
    { id:'INV-00901', po:null, poDate:null, matchAttempted:false, supplier:null, outlet:'Surry Hills', date:'13 June, 12:40', source:'email', amount:554.4, status:'pending', by:'Idayu', viewed:false,
      lines:[{name:'Sparkling Water 1L',sku:'PDW-SPK-1L',uom:'btl',poPrice:1.80,invPrice:1.80,qty:120,grn:null},{name:'Orange Juice 1L',sku:'PDW-OJ-1L',uom:'btl',poPrice:3.60,invPrice:3.60,qty:80,grn:null}] },
    { id:'INV-00902', po:'PO-5523', poDate:'14 June 2026', supplier:'Harbour Meats', outlet:'Parramatta Table', date:'14 June, 07:05', source:'photo', viaGRN:true, grnRef:'GRN-3390', amount:554.4, status:'pending', by:'Keith Tan', viewed:false,
      lines:[{name:'Chicken Breast 500g',sku:'HM-CHKB-500',uom:'kg',poPrice:8.40,invPrice:8.40,qty:40,grn:null},{name:'Lamb Rack (each)',sku:'HM-LMR-EA',uom:'ea',poPrice:28.00,invPrice:28.00,qty:6,grn:null}] },
    { id:'INV-00903', po:'PO-5524', poDate:'14 June 2026', supplier:'Metro Bakery Supplies', outlet:'Bondi Beach', date:'14 June, 15:30', source:'upload', amount:260.7, status:'pending', by:'Waihong Chee', viewed:true,
      lines:[{name:'Sourdough Loaf (each)',sku:'MBS-SRD-EA',uom:'ea',poPrice:5.50,invPrice:5.50,qty:30,grn:null},{name:'Croissant 6-pack',sku:'MBS-CRO-6PK',uom:'pkg',poPrice:9.00,invPrice:9.00,qty:8,grn:null}] },
    { id:'INV-00904', po:null, poDate:null, supplier:null, outlet:'Newtown', date:'15 June, 09:50', source:'email', amount:0, status:'pending', by:'Keith Tan', viewed:false, freshCapture:true, lines:[] },
    { id:'INV-00891', grnRef:'GRN-3402', po:'PO-5510', poDate:'9 June 2026', supplier:'Green Farmers Market', outlet:'Parramatta Table', date:'9 June, 11:05', source:'upload', amount:158.4, status:'ok', by:'Waihong Chee',
      lines:[{name:'Mixed Leaf 2kg',sku:'GFM-MXL-2KG',uom:'bag',poPrice:9.00,invPrice:9.00,qty:16,grn:16}] },
    { id:'INV-00884', grnRef:'GRN-3403', po:'PO-5518', poDate:'14 June 2026', supplier:'Pacific Drinks Wholesale', outlet:'Melbourne CBD', date:'14 June, 08:22', source:'peppol', amount:95.04, status:'ok', by:'PEPPOL',
      lines:[{name:'Sparkling Water 1L',sku:'PDW-SPK-1L',uom:'btl',poPrice:1.80,invPrice:1.80,qty:48,grn:48}] },
    { id:'INV-00889', grnRef:'GRN-3404', po:'PO-5509', poDate:'9 June 2026', supplier:'Harbour Meats', outlet:'Bondi Beach', date:'9 June, 16:40', source:'email', amount:1406.24, status:'risk', by:'Keith Tan',
      why:'Chicken Breast +6.2%, Salmon Fillet +19.3% above PO — S$170 overbilled', reasonTag:'Price',
      lines:[
        {name:'Chicken Breast 500g',sku:'HM-CHKB-500',uom:'kg',poPrice:8.40,invPrice:8.92,qty:40,grn:40},
        {name:'Salmon Fillet 200g',sku:'HM-SLMF-200',uom:'kg',poPrice:32.20,invPrice:38.40,qty:24,grn:24},
      ] },
    { id:'INV-00887', grnRef:'GRN-3405', po:'PO-5508', poDate:'8 June 2026', supplier:'Harbour Meats', outlet:'Newtown', date:'8 June, 13:10', source:'email', amount:349.8, status:'warn', by:'Keith Tan',
      why:'GRN confirms 8 Beef Short Rib + 4 Lamb Rack received — invoice bills for 12 and 6 — S$106 overbilled', reasonTag:'Quantity',
      lines:[
        {name:'Beef Short Rib 500g',sku:'HM-BSR-500',uom:'pkg',poPrice:12.50,invPrice:12.50,qty:12,grn:8},
        {name:'Lamb Rack (each)',sku:'HM-LMR-EA',uom:'ea',poPrice:28.00,invPrice:28.00,qty:6,grn:4},
      ] },
    { id:'INV-00885', grnRef:'GRN-3406', po:'PO-5507', poDate:'7 June 2026', supplier:'Green Farmers Market', outlet:'Surry Hills', date:'7 June, 15:52', source:'email', amount:587.4, status:'risk', by:'Idayu',
      why:'"Avocado" (each) +16.7% vs PO ($2.40 → $2.80) — no pre-approved price increase on file', reasonTag:'Price',
      lines:[
        {name:'Mixed Leaf 2kg',sku:'GFM-MXL-2KG',uom:'bag',poPrice:9.00,invPrice:9.00,qty:10,grn:10},
        {name:'Avocado (each)',sku:'GFM-AVO-EA',uom:'ea',poPrice:2.40,invPrice:2.80,qty:60,grn:60},
        {name:'Roma Tomatoes 5kg',sku:'GFM-TOM-5KG',uom:'box',poPrice:16.50,invPrice:16.50,qty:8,grn:8},
        {name:'Baby Spinach 1kg',sku:'GFM-SPN-1KG',uom:'bag',poPrice:12.00,invPrice:12.00,qty:12,grn:12},
      ],
      margin:{ headline:'Affects Avocado Toast v3 — now above target food cost', sub:'Food cost 28% → 34.7% · +16.7% Avocado price hasn’t been re-costed into the recipe yet' } },
    { id:'INV-00880', grnRef:'GRN-3407', po:'PO-5502', poDate:'5 June 2026', supplier:'Fresh Produce Co', outlet:'Surry Hills', date:'5 June, 10:30', source:'upload', amount:77.0, status:'approved', by:'Keith Tan',
      lines:[{name:'Cherry Tomatoes 250g',sku:'FPC-CHT-250',uom:'punnet',poPrice:3.50,invPrice:3.50,qty:20,grn:20}] },
    { id:'INV-00876', grnRef:'GRN-3408', po:'PO-5499', poDate:'1 June 2026', supplier:'Sydney Butchers Co.', outlet:'Bondi Beach', date:'1 June, 09:15', source:'email', amount:94.38, status:'exported', by:'Keith Tan', exportedTo:'Xero',
      lines:[{name:'Chicken Breast 500g',sku:'SBC-CHKB-500',uom:'pkg',poPrice:7.15,invPrice:7.15,qty:12,grn:12}] },
    { id:'INV-00897', po:null, poDate:null, supplier:'Harbour Meats', outlet:null, date:'12 June, 11:02', source:'email', amount:364, status:'pending', by:'Keith Tan',
      why:'No PO reference — high-confidence match found: PO-5512, same supplier, amount within 1%', reasonTag:'No PO linked', lines:[],
      capturedLines:[{name:'Chicken Wings 1kg', qty:20, invPrice:8.20},{name:'Pork Ribs 1kg', qty:16, invPrice:10.20}] },
    { id:'INV-00894', po:null, poDate:null, supplier:'Metro Bakery Supplies', outlet:null, date:'10 June, 09:47', source:'email', amount:145, status:'pending', by:'Keith Tan',
      why:'Supplier not registered in the system — no matching PO could be identified', reasonTag:'No PO linked', lines:[],
      capturedLines:[{name:'Sourdough Loaf (each)', qty:14, invPrice:5.50},{name:'Croissant 6-pack', qty:6, invPrice:9.00}] },
    { id:'INV-00898', po:null, poDate:null, supplier:null, outlet:'Bondi Beach', date:'12 June, 17:20', source:'photo', viaGRN:true, grnRef:'GRN-3381', amount:0, status:'invalid', legible:false, by:'Keith Tan',
      why:'Image too blurry to read — no supplier, invoice number, or amount could be extracted', reasonTag:'Unreadable', lines:[] },
    { id:'INV-00899', grnRef:'GRN-3409', po:'PO-5499', poDate:'1 June 2026', supplier:'Sydney Butchers Co.', outlet:'Bondi Beach', date:'2 June, 10:05', source:'email', amount:94.38, status:'duplicate', by:'Keith Tan',
      duplicateOf:'INV-00876', why:'Same supplier, PO, amount and invoice date as INV-00876 — already exported to Xero 1 day earlier', reasonTag:'Duplicate',
      lines:[{name:'Chicken Breast 500g',sku:'SBC-CHKB-500',uom:'pkg',poPrice:7.15,invPrice:7.15,qty:12,grn:12}] },
    /* ── item-set mismatches: the invoice and PO don't describe the same
       goods, a different problem than a price or quantity variance. Each
       PO number here (5530+) is invented for this invoice alone, not drawn
       from PO_CATALOG, so it doesn't remove a candidate from the live
       "link a PO" type-ahead demo above. ── */
    { id:'INV-00905', grnRef:'GRN-3410', po:'PO-5530', poDate:'15 June 2026', supplier:'Green Farmers Market', outlet:'Newtown', date:'16 June, 10:15', source:'email', amount:434.50, status:'warn', by:'Idayu',
      why:'Invoice includes Cherry Tomatoes 250g × 10 — not on PO-5530. Supplier may have added it from a request outside Procure.', reasonTag:'Extra items',
      lines:[
        {name:'Mixed Leaf 2kg',sku:'GFM-MXL-2KG',uom:'bag',poPrice:9.00,invPrice:9.00,qty:20,grn:20},
        {name:'Avocado (each)',sku:'GFM-AVO-EA',uom:'ea',poPrice:2.40,invPrice:2.40,qty:75,grn:75},
        {name:'Cherry Tomatoes 250g',sku:'GFM-CHT-250',uom:'punnet',invPrice:3.50,qty:10,grn:null,extra:true},
      ],
      // what the source document actually shows — all 3 items really are on
      // it; "extra" above is about PO-5530 not listing the third one, not
      // about anything being missing from the capture.
      capturedLines:[{name:'Mixed Leaf 2kg',qty:20,invPrice:9.00},{name:'Avocado (each)',qty:75,invPrice:2.40},{name:'Cherry Tomatoes 250g',qty:10,invPrice:3.50}] },
    { id:'INV-00906', grnRef:'GRN-3411', po:'PO-5531', poDate:'15 June 2026', supplier:'Harbour Meats', outlet:'Parramatta Table', date:'16 June, 08:30', source:'email', amount:180.40, status:'warn', by:'Keith Tan',
      why:'Pork Ribs 1kg (16kg on PO-5531) is not on this invoice — supplier may be out of stock.', reasonTag:'Items missing',
      lines:[
        {name:'Chicken Wings 1kg',sku:'HM-CHW-1KG',uom:'kg',poPrice:8.20,invPrice:8.20,qty:20,grn:20},
        {name:'Pork Ribs 1kg',sku:'HM-PRB-1KG',uom:'kg',poPrice:10.20,qty:16,grn:null,missing:true},
      ],
      // the document itself only lists Chicken Wings — Pork Ribs was never
      // captured because the supplier never invoiced it, which is the point.
      capturedLines:[{name:'Chicken Wings 1kg',qty:20,invPrice:8.20}] },
    { id:'INV-00907', grnRef:'GRN-3412', po:'PO-5532', poDate:'15 June 2026', supplier:'Metro Bakery Supplies', outlet:'Bondi Beach', date:'16 June, 12:05', source:'upload', amount:242.00, status:'risk', by:'Waihong Chee',
      why:'"Cinnamon Scrolls 4-pack" doesn’t match any item in the market list for Metro Bakery Supplies — needs to be mapped or added before this can be matched.', reasonTag:'Unmapped item',
      lines:[
        {name:'Sourdough Loaf (each)',sku:'MBS-SRD-EA',uom:'ea',poPrice:5.50,invPrice:5.50,qty:20,grn:20},
        {name:'Croissant 6-pack',sku:'MBS-CRO-6PK',uom:'pkg',poPrice:9.00,invPrice:9.00,qty:5,grn:5},
        {name:'Cinnamon Scrolls 4-pack',uom:'pkg',invPrice:6.50,qty:10,grn:null,unmapped:true},
      ],
      capturedLines:[{name:'Sourdough Loaf (each)',qty:20,invPrice:5.50},{name:'Croissant 6-pack',qty:5,invPrice:9.00},{name:'Cinnamon Scrolls 4-pack',qty:10,invPrice:6.50}] },
    /* ── dual-exception lines: a single line can fail price AND quantity at
       once (invPrice above poPrice, and grn short of the invoiced qty) —
       computeOutcome() still reports the invoice-level reasonTag as 'Price'
       (checked first), but the per-line Match pill on the detail screen
       combines both, and the GRN qty / PO price reference columns each
       tint independently regardless of which one the pill leads with. ── */
    { id:'INV-00908', grnRef:'GRN-3413', po:'PO-5533', poDate:'16 June 2026', supplier:'Harbour Meats', outlet:'Parramatta Table', date:'16 June, 14:20', source:'upload', amount:532.0, status:'risk', by:'Waihong Chee',
      why:'Chicken Breast is +8.3% vs PO ($8.40 → $9.10) and short-received (30 of 40 invoiced) — two separate exceptions on the same line.', reasonTag:'Price',
      lines:[
        {name:'Chicken Breast 500g',sku:'HM-CHKB-500',uom:'kg',poPrice:8.40,invPrice:9.10,qty:40,grn:30},
        {name:'Lamb Rack (each)',sku:'HM-LMR-EA',uom:'ea',poPrice:28.00,invPrice:28.00,qty:6,grn:6},
      ] },
    { id:'INV-00909', grnRef:'GRN-3414', po:'PO-5534', poDate:'16 June 2026', supplier:'Green Farmers Market', outlet:'Newtown', date:'16 June, 15:05', source:'email', amount:754.5, status:'risk', by:'Idayu',
      why:'Avocado is +14.6% vs PO and short-received (45 of 60); Baby Spinach is +12.5% vs PO; Roma Tomatoes is short-received (10 of 15) — multiple exceptions across this invoice.', reasonTag:'Price',
      lines:[
        {name:'Mixed Leaf 2kg',sku:'GFM-MXL-2KG',uom:'bag',poPrice:9.00,invPrice:9.00,qty:20,grn:20},
        {name:'Avocado (each)',sku:'GFM-AVO-EA',uom:'ea',poPrice:2.40,invPrice:2.75,qty:60,grn:45},
        {name:'Roma Tomatoes 5kg',sku:'GFM-TOM-5KG',uom:'box',poPrice:16.50,invPrice:16.50,qty:15,grn:10},
        {name:'Baby Spinach 1kg',sku:'GFM-SPN-1KG',uom:'bag',poPrice:12.00,invPrice:13.50,qty:12,grn:12},
      ] },
    /* ── no-PO, item-identity-only demo — for the "No matching" policy
       (see MATCH_MODE in app.js). Under the default 3-way policy this sits
       pending like any other no-PO invoice ('No PO linked'); switch
       Matching to "No matching" in Settings to see it auto-post except for
       the one unmapped line, which still needs a person's input — matching
       being off never means item identity stops being checked. lines is
       deliberately empty (no PO to build a working set from); capturedLines
       is what computeOutcome()/openDetail() read from in this mode. ── */
    { id:'INV-00910', po:null, poDate:null, supplier:'Fresh Produce Co', outlet:'Surry Hills', date:'16 June, 16:40', source:'photo', amount:156.90, status:'pending', by:'Waihong Chee', viewed:false,
      // Only shown once MATCH_MODE is switched to 'none' and this resolves
      // to 'risk' — under the default 3-way policy it's just another no-PO
      // invoice sitting in Uploads ('No PO linked'), same as INV-00894/97.
      why:'"Heirloom Carrot Bunch" doesn’t match any item in the market list for Fresh Produce Co — needs to be mapped or added before this can post.',
      lines:[],
      capturedLines:[
        {name:'Iceberg Lettuce (each)',sku:'FPC-ICE-EA',uom:'ea',invPrice:2.20,qty:30},
        {name:'Cherry Tomatoes 250g',sku:'FPC-CHT-250',uom:'punnet',invPrice:3.50,qty:15},
        {name:'Heirloom Carrot Bunch',uom:'bunch',invPrice:4.80,qty:8,unmapped:true},
      ] },
  ];

  /* ── PO catalog — stands in for a real PO lookup service. Every open PO a
     person could plausibly link to an unmatched invoice lives here, each with
     the supplier it belongs to and the line items a match would pull in. This
     is what the type-ahead searches and what "Link PO" validates against —
     a person can only ever attach a real, open, same-supplier PO, never
     arbitrary text, and picking one (not the specific invoice) is what drives
     the eventual match outcome. ── */
  const PO_CATALOG = [
    { po:'PO-5512', supplier:'Harbour Meats', poDate:'12 June 2026', amount:364, lines:[
        {name:'Chicken Wings 1kg', sku:'HM-CHW-1KG', uom:'kg', poPrice:8.20, qty:20, grn:20},
        {name:'Pork Ribs 1kg',     sku:'HM-PRB-1KG', uom:'kg', poPrice:10.20, qty:16, grn:16},
      ] },
    { po:'PO-5521', supplier:'Metro Bakery Supplies', poDate:'9 June 2026', amount:145, lines:[
        {name:'Sourdough Loaf (each)', sku:'MBS-SRD-EA', uom:'ea', poPrice:5.50, qty:20, grn:null},
        {name:'Croissant 6-pack',      sku:'MBS-CRO-6PK', uom:'pkg', poPrice:9.00, qty:5, grn:null},
      ] },
    { po:'PO-5525', supplier:'Green Farmers Market', poDate:'13 June 2026', amount:410, lines:[
        {name:'Mixed Leaf 2kg', sku:'GFM-MXL-2KG', uom:'bag', poPrice:9.00, qty:20, grn:20},
        {name:'Avocado (each)', sku:'GFM-AVO-EA', uom:'ea', poPrice:2.40, qty:75, grn:75},
      ] },
    { po:'PO-5526', supplier:'Fresh Produce Co', poDate:'11 June 2026', amount:300, lines:[
        {name:'Cherry Tomatoes 250g', sku:'FPC-CHT-250', uom:'punnet', poPrice:3.50, qty:60, grn:null},
      ] },
    { po:'PO-5527', supplier:'Sydney Butchers Co.', poDate:'8 June 2026', amount:180, lines:[
        {name:'Chicken Breast 500g', sku:'SBC-CHKB-500', uom:'pkg', poPrice:7.15, qty:25, grn:25},
      ] },
  ];
