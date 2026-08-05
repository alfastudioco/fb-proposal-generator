(function () {
  'use strict';

  const state = {
    sections: [], // { id, title, price, leftScope: [{type,text}], rightScope: [...] }
    clientSupplied: [], // [string]
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

  // ---- Snippet library (window.SNIPPET_LIBRARY, from snippets.js) -----------

  const SNIPPETS = window.SNIPPET_LIBRARY || { categories: [], notes: [], clientSuppliedCommon: [] };

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
    state.sections.push({ id, title: '', subtitle: '', price: 0, priceLabel: '', leftScope: [], rightScope: [] });
    renderRooms();
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

  // ---- Totals ---------------------------------------------------------------

  function formatCurrency(amount) {
    return `$${Math.round(amount || 0).toLocaleString('en-US')}`;
  }

  function recalcTotals() {
    const total = state.sections.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
    totalsAmountEl.textContent = formatCurrency(total);
  }

  // ---- Collect form state into the §7 proposal data model -------------------

  function collectProposalData() {
    return {
      proposalNum: el('proposalNum').value.trim(),
      date: el('proposalDate').value.trim(),
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
        leftScope: s.leftScope.filter((it) => it.text.trim()),
        rightScope: s.rightScope.filter((it) => it.text.trim()),
      })),
      clientSupplied: state.clientSupplied.filter((t) => t.trim()),
      notes: el('notes').value.trim(),
      totalLabel: el('totalLabel').value.trim(),
      totalAmount: state.sections.reduce((sum, s) => sum + (Number(s.price) || 0), 0),
      investmentNote: el('investmentNote').value.trim() || undefined,
    };
  }

  // ---- Preview ----------------------------------------------------------------

  async function previewProposal() {
    const data = collectProposalData();
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

  // ---- Wire up totals recompute on any input ---------------------------------

  document.addEventListener('input', recalcTotals);

  populateSnippetSelects();
  renderClientSupplied();
  recalcTotals();
  previewProposal();
})();
