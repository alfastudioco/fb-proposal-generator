(function () {
  'use strict';

  const state = {
    sections: [], // { id, title, price, leftScope: [{type,text}], rightScope: [...] }
    clientSupplied: [], // [string]
    paymentTermLines: [], // [{label, amount}]
    clientId: null, // set when an extracted client is matched/linked to an existing fbpg_clients row
    editingId: null, // set when loaded via ?edit=<id> -- Generate then updates this row instead of inserting a new one
  };

  let sectionIdCounter = 0;
  function nextSectionId() {
    sectionIdCounter += 1;
    return sectionIdCounter;
  }

  // ---- DOM refs ----------------------------------------------------------

  const el = (id) => document.getElementById(id);
  const roomsList = el('roomsList');
  const clientSuppliedList = el('clientSuppliedList');
  const roomCardTemplate = el('roomCardTemplate');
  const scopeItemTemplate = el('scopeItemTemplate');
  const clientSuppliedItemTemplate = el('clientSuppliedItemTemplate');
  const paymentTermLineTemplate = el('paymentTermLineTemplate');
  const paymentTermsList = el('paymentTermsList');
  const totalsAmountEl = el('totalsAmount');
  const previewFrame = el('previewFrame');
  const generateStatus = el('generateStatus');
  const downloadLinks = el('downloadLinks');

  // ---- Init defaults ------------------------------------------------------

  el('proposalDate').value = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  // Real starting value, not just a placeholder -- an empty-but-suggestive
  // placeholder here previously caused "proposalNum is required" errors on
  // Preview/Generate because the field looked filled in but wasn't.
  el('proposalNum').value = String(Date.now()).slice(-4);

  // ---- Client info extraction from an image ----------------------------------

  const MAX_IMAGE_DIMENSION = 1200;

  // Downscales via <canvas> before base64-encoding -- keeps the request well
  // under Vercel's ~4.5MB body limit and keeps vision latency/cost down.
  // Photos (business cards, handwritten notes) are usually far larger than
  // needed for text extraction at full resolution.
  function downscaleImageToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the image file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not decode the image file'));
        img.onload = () => {
          const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderClientMatches(matches) {
    const panel = el('clientMatchPanel');
    panel.innerHTML = '';
    if (!matches || !matches.length) {
      panel.classList.add('is-hidden');
      return;
    }
    panel.classList.remove('is-hidden');
    const heading = document.createElement('div');
    heading.textContent = 'Existing client found:';
    panel.appendChild(heading);
    matches.forEach((match) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `Use ${match.name}${match.address ? ` — ${match.address}` : ''}`;
      btn.addEventListener('click', () => {
        state.clientId = match.id;
        el('clientName').value = match.name || '';
        el('propertyAddress').value = match.address || '';
        el('clientPhone').value = match.phone || '';
        el('clientEmail').value = match.email || '';
        panel.classList.add('is-hidden');
      });
      panel.appendChild(btn);
    });
  }

  el('extractClientBtn').addEventListener('click', async () => {
    const fileInput = el('clientImageInput');
    const statusEl = el('clientExtractStatus');
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      statusEl.textContent = 'Choose an image first.';
      statusEl.className = 'generate-status error';
      return;
    }

    statusEl.textContent = 'Reading image…';
    statusEl.className = 'generate-status';
    el('clientMatchPanel').classList.add('is-hidden');

    try {
      const imageBase64 = await downscaleImageToBase64(file);
      statusEl.textContent = 'Extracting client info…';
      const res = await fetch('/api/extract-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mediaType: 'image/jpeg' }),
      });
      const body = await res.json();
      if (!res.ok) {
        statusEl.textContent = body.error || 'Extraction failed.';
        statusEl.className = 'generate-status error';
        return;
      }

      state.clientId = null;
      const { client, matches } = body;
      if (client.name) el('clientName').value = client.name;
      if (client.address) el('propertyAddress').value = client.address;
      if (client.phone) el('clientPhone').value = client.phone;
      if (client.email) el('clientEmail').value = client.email;
      renderClientMatches(matches);

      statusEl.textContent = 'Done — review the fields above before generating.';
      statusEl.className = 'generate-status';
    } catch (err) {
      statusEl.textContent = `Extraction failed: ${err.message}`;
      statusEl.className = 'generate-status error';
    }
  });

  // ---- Snippet library (window.SNIPPET_LIBRARY, from snippets.js) -----------

  const SNIPPETS = window.SNIPPET_LIBRARY || { categories: [], notes: [], clientSuppliedCommon: [], termsAndConditions: [] };

  function populateSnippetSelects() {
    // Populate the <template>'s select once, before any cloning -- every
    // future roomCardTemplate.content.cloneNode(true) then carries these
    // <option>s along automatically.
    const templateSelect = roomCardTemplate.content.querySelector('.room-snippet-select');
    for (const category of SNIPPETS.categories) {
      const opt = document.createElement('option');
      opt.value = category.id;
      opt.textContent = category.label;
      templateSelect.appendChild(opt);
    }

    const notesSelect = el('notesSnippetSelect');
    for (const note of SNIPPETS.notes) {
      const opt = document.createElement('option');
      opt.value = note.text;
      opt.textContent = note.label;
      notesSelect.appendChild(opt);
    }

    const clientSuppliedSelect = el('clientSuppliedSnippetSelect');
    for (const text of SNIPPETS.clientSuppliedCommon) {
      const opt = document.createElement('option');
      opt.value = text;
      opt.textContent = text.length > 60 ? `${text.slice(0, 57)}...` : text;
      clientSuppliedSelect.appendChild(opt);
    }

    const termsSelect = el('termsSnippetSelect');
    for (const clause of SNIPPETS.termsAndConditions || []) {
      const opt = document.createElement('option');
      opt.value = clause.text;
      opt.textContent = clause.label;
      termsSelect.appendChild(opt);
    }
  }

  // Splits a category's flat {type, text} list into left/right columns by
  // tradeLabel group (each tradeLabel + the bullets under it is one group),
  // alternating groups left/right -- mirrors how the real proposals pair a
  // "Demo & Structural"-style block against an "Installation & Finishes"
  // block side by side.
  function splitSnippetItems(items) {
    const groups = [];
    for (const item of items) {
      if (item.type === 'tradeLabel' || groups.length === 0) groups.push([]);
      groups[groups.length - 1].push(item);
    }
    const left = [];
    const right = [];
    groups.forEach((group, i) => (i % 2 === 0 ? left : right).push(...group));
    return { left, right };
  }

  function insertSnippetIntoRoom(sectionId, categoryId) {
    const category = SNIPPETS.categories.find((c) => c.id === categoryId);
    if (!category) return;
    const section = state.sections.find((s) => s.id === sectionId);
    const { left, right } = splitSnippetItems(category.items);
    section.leftScope.push(...left.map((it) => ({ ...it })));
    section.rightScope.push(...right.map((it) => ({ ...it })));
    if (!section.title) section.title = category.label;
    renderRooms();
  }

  // ---- Rooms & Scope --------------------------------------------------------

  function addRoom() {
    const id = nextSectionId();
    state.sections.push({
      id, title: '', subtitle: '', price: 0, priceLabel: '', description: '', scopeStatus: null,
      leftScope: [], rightScope: [],
    });
    renderRooms();
  }

  async function generateScopeForRoom(sectionId, description) {
    const section = state.sections.find((s) => s.id === sectionId);
    if (!section) return;
    if (!description.trim()) {
      section.scopeStatus = { text: 'Describe the project first.', error: true };
      renderRooms();
      return;
    }

    section.scopeStatus = { text: 'Generating…', error: false };
    renderRooms();

    try {
      const res = await fetch('/api/generate-scope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, roomTitle: section.title }),
      });
      const body = await res.json();
      if (!res.ok) {
        section.scopeStatus = { text: body.error || 'Scope generation failed.', error: true };
        renderRooms();
        return;
      }

      const { left, right } = splitSnippetItems(body.items || []);
      section.leftScope.push(...left);
      section.rightScope.push(...right);
      if (typeof body.suggestedPrice === 'number') section.price = body.suggestedPrice;
      section.scopeStatus = { text: body.priceRationale ? `Estimate: ${body.priceRationale}` : 'Done.', error: false };
      renderRooms();
      recalcTotals();
    } catch (err) {
      section.scopeStatus = { text: `Failed: ${err.message}`, error: true };
      renderRooms();
    }
  }

  function removeRoom(id) {
    state.sections = state.sections.filter((s) => s.id !== id);
    renderRooms();
    recalcTotals();
  }

  function addScopeItem(sectionId, side, type) {
    const section = state.sections.find((s) => s.id === sectionId);
    section[side === 'left' ? 'leftScope' : 'rightScope'].push({ type, text: '' });
    renderRooms();
  }

  function removeScopeItem(sectionId, side, index) {
    const section = state.sections.find((s) => s.id === sectionId);
    section[side === 'left' ? 'leftScope' : 'rightScope'].splice(index, 1);
    renderRooms();
  }

  function renderRooms() {
    roomsList.innerHTML = '';
    for (const section of state.sections) {
      const card = roomCardTemplate.content.cloneNode(true);
      const cardEl = card.querySelector('.room-card');

      const titleInput = card.querySelector('.room-title');
      titleInput.value = section.title;
      titleInput.addEventListener('input', () => { section.title = titleInput.value; });

      const subtitleInput = card.querySelector('.room-subtitle');
      subtitleInput.value = section.subtitle || '';
      subtitleInput.addEventListener('input', () => { section.subtitle = subtitleInput.value; });

      const priceInput = card.querySelector('.room-price');
      priceInput.value = section.price || '';
      priceInput.addEventListener('input', () => {
        section.price = Number(priceInput.value) || 0;
        recalcTotals();
      });

      const priceLabelInput = card.querySelector('.room-price-label-input');
      priceLabelInput.value = section.priceLabel || '';
      priceLabelInput.addEventListener('input', () => { section.priceLabel = priceLabelInput.value; });

      card.querySelector('.room-remove').addEventListener('click', () => removeRoom(section.id));

      const snippetSelect = card.querySelector('.room-snippet-select');
      snippetSelect.addEventListener('change', () => {
        if (snippetSelect.value) insertSnippetIntoRoom(section.id, snippetSelect.value);
      });

      const descTextarea = card.querySelector('.room-description');
      descTextarea.value = section.description || '';
      descTextarea.addEventListener('input', () => { section.description = descTextarea.value; });

      const scopeStatusEl = card.querySelector('.room-scope-status');
      if (section.scopeStatus) {
        scopeStatusEl.textContent = section.scopeStatus.text;
        scopeStatusEl.className = `room-scope-status${section.scopeStatus.error ? ' error' : ''}`;
      }

      card.querySelector('.generate-scope-btn').addEventListener('click', () => {
        generateScopeForRoom(section.id, descTextarea.value);
      });

      for (const side of ['left', 'right']) {
        const columnEl = card.querySelector(`.scope-items[data-side="${side}"]`);
        const items = side === 'left' ? section.leftScope : section.rightScope;
        items.forEach((item, index) => {
          const itemFrag = scopeItemTemplate.content.cloneNode(true);
          const itemEl = itemFrag.querySelector('.scope-item');
          if (item.type === 'tradeLabel') itemEl.classList.add('is-trade-label');
          const textInput = itemFrag.querySelector('.scope-item-text');
          textInput.value = item.text;
          textInput.placeholder = item.type === 'tradeLabel' ? 'Trade label (e.g. Plumbing)' : 'Bullet text';
          textInput.addEventListener('input', () => { item.text = textInput.value; });
          itemFrag.querySelector('.scope-item-remove').addEventListener('click', () => removeScopeItem(section.id, side, index));
          columnEl.appendChild(itemFrag);
        });

        const header = card.querySelector(`.scope-column[data-side="${side}"] .scope-column-header`);
        header.querySelectorAll('[data-add]').forEach((btn) => {
          btn.addEventListener('click', () => addScopeItem(section.id, side, btn.dataset.add));
        });
      }

      roomsList.appendChild(cardEl);
    }
  }

  el('addRoomBtn').addEventListener('click', addRoom);

  // ---- Client-supplied items -----------------------------------------------

  function addClientSuppliedItem() {
    state.clientSupplied.push('');
    renderClientSupplied();
  }

  function removeClientSuppliedItem(index) {
    state.clientSupplied.splice(index, 1);
    renderClientSupplied();
  }

  function renderClientSupplied() {
    clientSuppliedList.innerHTML = '';
    state.clientSupplied.forEach((text, index) => {
      const frag = clientSuppliedItemTemplate.content.cloneNode(true);
      const input = frag.querySelector('.scope-item-text');
      input.value = text;
      input.addEventListener('input', () => { state.clientSupplied[index] = input.value; });
      frag.querySelector('.scope-item-remove').addEventListener('click', () => removeClientSuppliedItem(index));
      clientSuppliedList.appendChild(frag);
    });
  }

  el('addClientSuppliedBtn').addEventListener('click', addClientSuppliedItem);

  el('clientSuppliedSnippetSelect').addEventListener('change', (e) => {
    if (!e.target.value) return;
    state.clientSupplied.push(e.target.value);
    renderClientSupplied();
    e.target.value = '';
  });

  el('notesSnippetSelect').addEventListener('change', (e) => {
    if (!e.target.value) return;
    const notesEl = el('notes');
    notesEl.value = notesEl.value.trim() ? `${notesEl.value.trim()}\n${e.target.value}` : e.target.value;
    e.target.value = '';
  });

  el('termsSnippetSelect').addEventListener('change', (e) => {
    if (!e.target.value) return;
    const termsEl = el('termsAndConditions');
    termsEl.value = termsEl.value.trim() ? `${termsEl.value.trim()}\n${e.target.value}` : e.target.value;
    e.target.value = '';
  });

  // ---- Payment terms ----------------------------------------------------------

  function addPaymentTermLine() {
    state.paymentTermLines.push({ label: '', amount: 0 });
    renderPaymentTermLines();
  }

  function removePaymentTermLine(index) {
    state.paymentTermLines.splice(index, 1);
    renderPaymentTermLines();
  }

  function renderPaymentTermLines() {
    paymentTermsList.innerHTML = '';
    state.paymentTermLines.forEach((line, index) => {
      const frag = paymentTermLineTemplate.content.cloneNode(true);
      const labelInput = frag.querySelector('.payment-term-label');
      const amountInput = frag.querySelector('.payment-term-amount');
      labelInput.value = line.label;
      amountInput.value = line.amount || '';
      labelInput.addEventListener('input', () => { line.label = labelInput.value; });
      amountInput.addEventListener('input', () => { line.amount = Number(amountInput.value) || 0; });
      frag.querySelector('.payment-term-remove').addEventListener('click', () => removePaymentTermLine(index));
      paymentTermsList.appendChild(frag);
    });
  }

  el('addPaymentTermBtn').addEventListener('click', addPaymentTermLine);

  el('paymentTermsToggle').addEventListener('change', (e) => {
    el('paymentTermsPanel').classList.toggle('is-hidden', !e.target.checked);
    if (e.target.checked && !state.paymentTermLines.length) addPaymentTermLine();
  });

  // ---- Totals ---------------------------------------------------------------

  function formatCurrency(amount) {
    return `$${Math.round(amount || 0).toLocaleString('en-US')}`;
  }

  function recalcTotals() {
    const total = state.sections.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
    totalsAmountEl.textContent = formatCurrency(total);
  }

  // ---- Collect form state into the §7 proposal data model -------------------

  // forPreview keeps empty-but-just-added rows (a bullet from "+ Add
  // bullet", a payment line, etc.) in the payload instead of filtering
  // them out, so they still exist for the user to type into once the
  // preview re-renders. The real save/generate path (forPreview: false,
  // the default) filters them -- an empty dash bullet has no business in
  // the actual delivered document.
  function collectProposalData({ forPreview = false } = {}) {
    return {
      proposalNum: el('proposalNum').value.trim(),
      date: el('proposalDate').value.trim(),
      clientId: state.clientId || undefined,
      id: state.editingId || undefined,
      client: {
        name: el('clientName').value.trim(),
        address: el('propertyAddress').value.trim(),
        phone: el('clientPhone').value.trim(),
        email: el('clientEmail').value.trim(),
      },
      sections: state.sections.map((s, i) => ({
        num: i + 1,
        title: s.title,
        subtitle: s.subtitle ? s.subtitle.trim() : undefined,
        price: Number(s.price) || 0,
        priceLabel: s.priceLabel ? s.priceLabel.trim() : undefined,
        leftScope: forPreview ? s.leftScope.map((it) => ({ ...it })) : s.leftScope.filter((it) => it.text.trim()),
        rightScope: forPreview ? s.rightScope.map((it) => ({ ...it })) : s.rightScope.filter((it) => it.text.trim()),
      })),
      clientSupplied: forPreview ? [...state.clientSupplied] : state.clientSupplied.filter((t) => t.trim()),
      notes: el('notes').value.trim(),
      totalLabel: el('totalLabel').value.trim(),
      totalAmount: state.sections.reduce((sum, s) => sum + (Number(s.price) || 0), 0),
      investmentNote: el('investmentNote').value.trim() || undefined,
      expirationDate: el('expirationDate').value.trim() || undefined,
      termsAndConditions: el('termsAndConditions').value.trim() || undefined,
      paymentTerms: collectPaymentTerms(forPreview),
    };
  }

  function collectPaymentTerms(forPreview = false) {
    if (!el('paymentTermsToggle').checked) return undefined;
    const lines = forPreview
      ? state.paymentTermLines.map((l) => ({ label: l.label, amount: Number(l.amount) || 0 }))
      : state.paymentTermLines.filter((l) => l.label.trim()).map((l) => ({ label: l.label.trim(), amount: Number(l.amount) || 0 }));
    if (!lines.length) return undefined;
    return { lines, note: el('paymentTermsNote').value.trim() || undefined };
  }

  // ---- Load a saved proposal for editing (?edit=<id>) ------------------------

  async function loadProposalForEdit(id) {
    try {
      const res = await fetch(`/api/proposals?id=${encodeURIComponent(id)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load proposal');
      const p = body.proposal;

      el('clientName').value = p.client_name || '';
      el('propertyAddress').value = p.client_address || '';
      el('clientPhone').value = p.client_phone || '';
      el('clientEmail').value = p.client_email || '';
      el('proposalNum').value = p.proposal_num || '';
      el('proposalDate').value = p.date || '';
      el('notes').value = p.notes || '';
      el('totalLabel').value = p.total_label || '';
      el('investmentNote').value = p.investment_note || '';
      el('expirationDate').value = p.expiration_date || '';
      el('termsAndConditions').value = p.terms_and_conditions || '';

      state.editingId = id;
      state.clientId = p.client_id ?? null;

      state.sections = (p.sections || []).map((s) => ({
        id: nextSectionId(),
        title: s.title || '',
        subtitle: s.subtitle || '',
        price: s.price || 0,
        priceLabel: s.priceLabel || '',
        description: '',
        scopeStatus: null,
        leftScope: (s.leftScope || []).map((it) => ({ ...it })),
        rightScope: (s.rightScope || []).map((it) => ({ ...it })),
      }));

      state.clientSupplied = Array.isArray(p.client_supplied) ? [...p.client_supplied] : [];

      if (p.payment_terms && Array.isArray(p.payment_terms.lines)) {
        el('paymentTermsToggle').checked = true;
        el('paymentTermsPanel').classList.remove('is-hidden');
        state.paymentTermLines = p.payment_terms.lines.map((l) => ({ label: l.label || '', amount: l.amount || 0 }));
        el('paymentTermsNote').value = p.payment_terms.note || '';
      }

      const indicator = el('editingIndicator');
      indicator.textContent = `Editing Proposal #${p.proposal_num}`;
      indicator.classList.remove('is-hidden');
      el('generateBtn').textContent = 'Save Changes';

      renderRooms();
      renderClientSupplied();
      renderPaymentTermLines();
    } catch (err) {
      generateStatus.textContent = `Could not load proposal to edit: ${err.message}`;
      generateStatus.className = 'generate-status error';
    }
  }

  // ---- Editing directly in the preview ---------------------------------------
  //
  // The preview <iframe> renders with editable:true (see api/preview.js),
  // which adds contenteditable fields and small add/remove controls, bridged
  // back here via postMessage since the iframe is a separate document (see
  // the bridge script in generator/renderHtml.js for the wire format). Text
  // edits arrive on blur (not per-keystroke), so applying them here never
  // fights an edit still in progress; structural changes (add/remove) just
  // re-use the exact same functions the sidebar's own buttons call.

  function parseCurrencyInput(text) {
    return Number(String(text).replace(/[^0-9.]/g, '')) || 0;
  }

  const SIMPLE_FIELD_TO_INPUT_ID = {
    'client.name': 'clientName',
    'client.address': 'propertyAddress',
    'client.phone': 'clientPhone',
    'client.email': 'clientEmail',
    proposalNum: 'proposalNum',
    date: 'proposalDate',
    totalLabel: 'totalLabel',
    investmentNote: 'investmentNote',
    notes: 'notes',
    termsAndConditions: 'termsAndConditions',
    expirationDate: 'expirationDate',
    'paymentTerms.note': 'paymentTermsNote',
  };

  function applyPreviewEdit(field, rawValue) {
    const value = (rawValue == null ? '' : String(rawValue)).trim();

    const inputId = SIMPLE_FIELD_TO_INPUT_ID[field];
    if (inputId) {
      el(inputId).value = value;
      return;
    }

    let m;
    if ((m = field.match(/^sections\.(\d+)\.(title|subtitle|priceLabel)$/))) {
      const section = state.sections[Number(m[1])];
      if (section) { section[m[2]] = value; renderRooms(); }
      return;
    }
    if ((m = field.match(/^sections\.(\d+)\.price$/))) {
      const section = state.sections[Number(m[1])];
      if (section) { section.price = parseCurrencyInput(value); renderRooms(); recalcTotals(); }
      return;
    }
    if ((m = field.match(/^sections\.(\d+)\.(leftScope|rightScope)\.(\d+)\.text$/))) {
      const section = state.sections[Number(m[1])];
      const item = section && section[m[2]][Number(m[3])];
      if (item) { item.text = value; renderRooms(); }
      return;
    }
    if ((m = field.match(/^clientSupplied\.(\d+)$/))) {
      const i = Number(m[1]);
      if (state.clientSupplied[i] !== undefined) { state.clientSupplied[i] = value; renderClientSupplied(); }
      return;
    }
    if ((m = field.match(/^paymentTerms\.lines\.(\d+)\.label$/))) {
      const line = state.paymentTermLines[Number(m[1])];
      if (line) { line.label = value; renderPaymentTermLines(); }
      return;
    }
    if ((m = field.match(/^paymentTerms\.lines\.(\d+)\.amount$/))) {
      const line = state.paymentTermLines[Number(m[1])];
      if (line) { line.amount = parseCurrencyInput(value); renderPaymentTermLines(); recalcTotals(); }
    }
  }

  function applyPreviewStructuralChange(action, payload) {
    switch (action) {
      case 'add-room':
        addRoom();
        break;
      case 'remove-room': {
        const section = state.sections[payload.section];
        if (section) removeRoom(section.id);
        break;
      }
      case 'add-bullet': {
        const section = state.sections[payload.section];
        if (section) addScopeItem(section.id, payload.side, 'bullet');
        break;
      }
      case 'remove-item': {
        const section = state.sections[payload.section];
        if (section) removeScopeItem(section.id, payload.side, payload.index);
        break;
      }
      case 'add-client-supplied':
        addClientSuppliedItem();
        break;
      case 'remove-client-supplied':
        removeClientSuppliedItem(payload.index);
        break;
      case 'add-payment-line':
        addPaymentTermLine();
        break;
      case 'remove-payment-line':
        removePaymentTermLine(payload.index);
        break;
      default:
        return;
    }
    // Structural changes reshape the preview's DOM (a row appeared/vanished),
    // unlike a text edit -- a full re-render is the only reliable way to
    // reflect that, so (unlike applyPreviewEdit) this does trigger one.
    previewProposal();
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.source !== 'fbpg-preview') return;
    if (msg.type === 'edit') {
      applyPreviewEdit(msg.field, msg.value);
    } else if (msg.type === 'structural') {
      applyPreviewStructuralChange(msg.action, msg.payload || {});
    }
  });

  // Sidebar -> preview: debounced so a fast typist doesn't fire a network
  // round-trip per keystroke. Structural preview edits above already
  // trigger their own immediate refresh, independent of this.
  let previewRefreshTimer = null;
  function schedulePreviewRefresh() {
    clearTimeout(previewRefreshTimer);
    previewRefreshTimer = setTimeout(previewProposal, 600);
  }

  // ---- Preview ----------------------------------------------------------------

  async function previewProposal() {
    const data = collectProposalData({ forPreview: true });
    if (!data.sections.length) {
      previewFrame.srcdoc = '<p style="font-family:Arial;color:#888;padding:24px;">Add at least one room to see a preview.</p>';
      return;
    }
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) {
        previewFrame.srcdoc = `<p style="font-family:Arial;color:#b3261e;padding:24px;">${(body.details || []).join('<br>') || body.error}</p>`;
        return;
      }
      previewFrame.srcdoc = body.html;
    } catch (err) {
      previewFrame.srcdoc = `<p style="font-family:Arial;color:#b3261e;padding:24px;">Preview failed: ${err.message}</p>`;
    }
  }

  el('previewBtn').addEventListener('click', previewProposal);

  // ---- Generate -----------------------------------------------------------------

  async function generateProposal() {
    const data = collectProposalData();
    const generateBtn = el('generateBtn');
    generateBtn.disabled = true;
    generateStatus.textContent = 'Generating Word and PDF — this can take a few seconds…';
    generateStatus.className = 'generate-status';
    downloadLinks.innerHTML = '';

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) {
        generateStatus.textContent = body.details ? (Array.isArray(body.details) ? body.details.join(' ') : body.details) : body.error;
        generateStatus.className = 'generate-status error';
        return;
      }
      generateStatus.textContent = 'Done.';
      downloadLinks.innerHTML = '';
      if (body.docxUrl) {
        const a = document.createElement('a');
        a.href = body.docxUrl;
        a.textContent = 'Download Word';
        downloadLinks.appendChild(a);
      }
      if (body.pdfUrl) {
        const a = document.createElement('a');
        a.href = body.pdfUrl;
        a.textContent = 'Download PDF';
        downloadLinks.appendChild(a);
      }
    } catch (err) {
      generateStatus.textContent = `Network error: ${err.message}`;
      generateStatus.className = 'generate-status error';
    } finally {
      generateBtn.disabled = false;
    }
  }

  el('generateBtn').addEventListener('click', generateProposal);

  // ---- Wire up totals recompute + live preview sync on any input -------------

  document.addEventListener('input', recalcTotals);
  document.addEventListener('input', schedulePreviewRefresh);
  document.addEventListener('change', schedulePreviewRefresh);

  async function init() {
    populateSnippetSelects();
    const editId = new URLSearchParams(location.search).get('edit');
    if (editId) {
      await loadProposalForEdit(editId);
    } else {
      renderClientSupplied();
    }
    recalcTotals();
    previewProposal();
  }

  init();
})();
