// Reusable scope/notes library, built from FB Construction's actual past
// proposals (extracted, generalized, and de-identified from real project
// documents — client names, addresses, and one-off pricing were dropped;
// the recurring procedural language was kept, since that's what's
// actually reusable across jobs). Loaded via <script> in index.html as a
// plain global, matching the app's no-build-step convention.
//
// Each category's `items` array is ready to append directly into a
// room's leftScope/rightScope (matches the {type, text} shape from
// generator/validate.js). Users pick a category, it gets inserted, then
// they edit specifics (counts, materials, dimensions) for the real job.

window.SNIPPET_LIBRARY = {
  categories: [
    {
      id: 'kitchen',
      label: 'Kitchen Remodel',
      items: [
        { type: 'tradeLabel', text: 'Demo & Rough Work' },
        { type: 'bullet', text: 'Demo existing kitchen cabinets and appliances (includes garbage haul away)' },
        { type: 'bullet', text: 'Demo existing flooring — remove to subfloor and put new durrock to prepare for tile installation' },
        { type: 'bullet', text: 'Demo and disconnect plumbing as needed to remove sink and faucet' },
        { type: 'bullet', text: 'Demo electrical and relocate can lights and outlets as needed based on new layout' },
        { type: 'tradeLabel', text: 'Plumbing & Electrical' },
        { type: 'bullet', text: 'Provide new plumbing lines and drains to connect new sink and faucet in new location' },
        { type: 'bullet', text: 'Provide electrical for new stove' },
        { type: 'bullet', text: 'Install hood and exhaust vent out to exterior (if over 600 CFM exhaust, a fresh air intake is required)' },
        { type: 'bullet', text: 'Provide electrical for under-cabinet lights' },
        { type: 'tradeLabel', text: 'Installation & Finishes' },
        { type: 'bullet', text: 'Install and supply new baseboards' },
        { type: 'bullet', text: 'Install customer-supplied cabinets, appliances, hardware, and backsplash tile' },
        { type: 'bullet', text: 'Sink supplied by owner, installed by us' },
        { type: 'bullet', text: 'Counter top installed and charged by vendor (can also do full high backsplash)' },
        { type: 'bullet', text: 'Repair drywall, tape, patch, and prepare for paint' },
        { type: 'bullet', text: 'Paint kitchen ceiling and walls' },
      ],
    },
    {
      id: 'bathroom',
      label: 'Bathroom Remodel (Full/Master)',
      items: [
        { type: 'tradeLabel', text: 'Demo & Structural' },
        { type: 'bullet', text: 'Demo existing bathroom including tub, tile, toilet, and vanity' },
        { type: 'tradeLabel', text: 'Plumbing & Electrical' },
        { type: 'bullet', text: 'Provide all plumbing required for disconnection and connection of plumbing fixtures and shower faucets' },
        { type: 'bullet', text: 'Provide all electrical required for outlets, can lights, and vanity lights/sconces' },
        { type: 'tradeLabel', text: 'Shower & Tile Prep' },
        { type: 'bullet', text: 'Install new durrock on floor and shower walls, provide proper waterproofing' },
        { type: 'bullet', text: 'Build out shower base with rubber underlayment and prepare for new shower base with tile' },
        { type: 'bullet', text: 'Build out niche in shower' },
        { type: 'bullet', text: 'Install customer-supplied shower door (custom fabrication for non-standard sizes: $2,400–$2,800 installed)' },
        { type: 'tradeLabel', text: 'Installation & Finishes' },
        { type: 'bullet', text: 'Install new customer-supplied tile, vanity, faucet, toilet, exhaust fan, mirror, and lights' },
        { type: 'bullet', text: 'Install new exhaust fan, vented to exterior' },
        { type: 'bullet', text: 'Drywall, tape, patch, and paint' },
      ],
    },
    {
      id: 'powder-room',
      label: 'Powder Room',
      items: [
        { type: 'tradeLabel', text: 'Demo & Prep' },
        { type: 'bullet', text: 'Demo powder room including all mirrors' },
        { type: 'tradeLabel', text: 'Installation & Finishes' },
        { type: 'bullet', text: 'Install customer-supplied vanity and toilet' },
        { type: 'bullet', text: 'Install customer-supplied tile' },
        { type: 'bullet', text: 'Paint' },
      ],
    },
    {
      id: 'addition',
      label: 'Room Addition / Framing',
      items: [
        { type: 'tradeLabel', text: 'Site & Structural' },
        { type: 'bullet', text: 'Excavation and site prep' },
        { type: 'bullet', text: 'Pour concrete footing and foundation wall' },
        { type: 'bullet', text: 'Framing — frame out space according to final approved plans, including exterior walls, interior walls, window/door openings, and roof' },
        { type: 'tradeLabel', text: 'Systems' },
        { type: 'bullet', text: 'Provide all electrical required by code for outlets, switches, and ceiling lights based on final design' },
        { type: 'bullet', text: 'Provide and install a separate HVAC unit with condenser for heating and cooling' },
        { type: 'bullet', text: 'Provide and install smoke detectors with carbon monoxide sensor' },
        { type: 'tradeLabel', text: 'Exterior' },
        { type: 'bullet', text: 'Install new shingled roof, gutter, fascia, soffit, and downspout' },
        { type: 'bullet', text: 'Install siding on exterior to match existing' },
        { type: 'tradeLabel', text: 'Interior' },
        { type: 'bullet', text: 'Provide and install insulation' },
        { type: 'bullet', text: 'Install drywall, tape, patch, and prime' },
        { type: 'bullet', text: 'Install interior doors, baseboard, and shoebase' },
        { type: 'bullet', text: 'Paint entire addition' },
      ],
    },
    {
      id: 'laundry-mudroom',
      label: 'Laundry Room / Mudroom',
      items: [
        { type: 'tradeLabel', text: 'Demo & Rough Work' },
        { type: 'bullet', text: 'Frame out space required for new laundry room / mudroom' },
        { type: 'tradeLabel', text: 'Systems' },
        { type: 'bullet', text: 'Provide all electrical required for outlets, can lights, and vanity lights' },
        { type: 'bullet', text: 'Provide all plumbing required for connection of washer, sink, and drains (gas line if gas unit)' },
        { type: 'tradeLabel', text: 'Installation & Finishes' },
        { type: 'bullet', text: 'Install cabinets, sink, and pantry' },
        { type: 'bullet', text: 'Built-in bench, hooks, and cubbies' },
        { type: 'bullet', text: 'Tape, patch, and paint' },
      ],
    },
    {
      id: 'flooring',
      label: 'Flooring',
      items: [
        { type: 'tradeLabel', text: 'Demo & Prep' },
        { type: 'bullet', text: 'Remove existing flooring and baseboard' },
        { type: 'bullet', text: 'Level and prep subfloor as needed' },
        { type: 'tradeLabel', text: 'Installation & Finishes' },
        { type: 'bullet', text: 'Install new hardwood flooring (includes sand, stain, and varnish — color select), labor and material included' },
        { type: 'bullet', text: 'Install new baseboard and shoe base' },
      ],
    },
    {
      id: 'painting',
      label: 'Interior Painting',
      items: [
        { type: 'tradeLabel', text: 'Prep' },
        { type: 'bullet', text: 'Remove wallpaper where needed and repair walls to prepare for paint' },
        { type: 'bullet', text: 'Skim coat, sand, and prime' },
        { type: 'tradeLabel', text: 'Paint' },
        { type: 'bullet', text: 'Paint entire space — 2 coats Benjamin Moore' },
        { type: 'bullet', text: 'All baseboard, casing, doors, and trim sprayed' },
      ],
    },
    {
      id: 'roofing',
      label: 'Roofing',
      items: [
        { type: 'tradeLabel', text: 'Roofing' },
        { type: 'bullet', text: 'Tear off and reroof' },
        { type: 'bullet', text: 'Includes garbage haul away' },
        { type: 'bullet', text: 'Includes labor and material' },
      ],
    },
    {
      id: 'deck-refinish',
      label: 'Deck — Power Wash & Restain',
      items: [
        { type: 'tradeLabel', text: 'Deck Refinish' },
        { type: 'bullet', text: 'Power wash deck including hand rail, decking, and side boards' },
        { type: 'bullet', text: 'Replace damaged boards as needed' },
        { type: 'bullet', text: 'Light sanding after power wash' },
        { type: 'bullet', text: 'Apply stain' },
        { type: 'bullet', text: 'Includes all labor and material' },
      ],
    },
    {
      id: 'deck-new',
      label: 'Deck — New Build',
      items: [
        { type: 'tradeLabel', text: 'Deck Construction' },
        { type: 'bullet', text: 'Dig and pour foundation for posts' },
        { type: 'bullet', text: 'Install new posts and framing (treated wood)' },
        { type: 'bullet', text: 'Install decking and railing' },
        { type: 'bullet', text: 'Includes all material and labor' },
      ],
    },
    {
      id: 'fence',
      label: 'Fence Installation',
      items: [
        { type: 'tradeLabel', text: 'Fence Installation' },
        { type: 'bullet', text: 'Provide and install new fence as marked on the plat' },
        { type: 'bullet', text: 'All post depths per code' },
        { type: 'bullet', text: 'Material and height per selection' },
      ],
    },
    {
      id: 'electrical',
      label: 'Electrical Panel / Service Upgrade',
      items: [
        { type: 'tradeLabel', text: 'Electrical' },
        { type: 'bullet', text: 'Provide and replace electrical panel' },
        { type: 'bullet', text: 'Provide and install overhead panel, ground rod outside, and install all breakers' },
      ],
    },
    {
      id: 'windows-doors',
      label: 'Windows & Doors',
      items: [
        { type: 'tradeLabel', text: 'Windows & Doors' },
        { type: 'bullet', text: 'Remove and replace with like-for-like openings, includes labor and material' },
        { type: 'bullet', text: 'White interior, white exterior vinyl with LowE, argon gas, double pane' },
        { type: 'bullet', text: 'New casing included' },
      ],
    },
    {
      id: 'cabinetry',
      label: 'Custom Cabinetry & Millwork',
      items: [
        { type: 'tradeLabel', text: 'Custom Cabinetry' },
        { type: 'bullet', text: 'Custom cabinets based on final layout — plywood interior boxes, wood doors' },
        { type: 'bullet', text: 'All soft-close hinges and slides' },
        { type: 'bullet', text: 'Includes all labor, material, and installation' },
      ],
    },
  ],

  // Standard notes/exclusions language, reused near-verbatim across many
  // real proposals. Inserted into the Notes field; user can edit/trim.
  notes: [
    {
      label: 'Permit fees not included',
      text: 'Permit fees not included — FB Construction will manage all permit paperwork.',
    },
    {
      label: 'Blueprints not included',
      text: 'Blueprints for permit not included. Will provide sketches if sufficient for the permit set.',
    },
    {
      label: 'Concrete repair not included',
      text: 'Concrete repair not included — need to confirm full square footage and repair options.',
    },
    {
      label: 'Shower door by vendor',
      text: 'Shower door fabricated and installed by third-party vendor (price not included) — if a stock item, we can install.',
    },
    {
      label: 'Countertop by vendor',
      text: 'Counter top installed and charged by vendor (can also do full high backsplash).',
    },
    {
      label: 'Client-supplied materials on site',
      text: 'All client-supplied materials should be on site prior to scheduled installation.',
    },
  ],

  // Common "client-supplied" items, seen repeatedly across kitchen/bath
  // proposals.
  clientSuppliedCommon: [
    'All kitchen cabinets, hardware, appliances, exhaust hood/fan, counter top, sink, and faucet',
    'Bathtub, toilet, accessories, hardware, tile, sinks, faucet, vanity, and counter top',
    'All rough-in and trim fixtures for plumbing',
    'Skylights, patio doors, and windows',
    'Shower door',
  ],
};
