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
  const MAX_ROOM_LAYOUT_IMAGES = 5;

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

  // ---- Import an entire proposal from an uploaded invoice/estimate document --

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the file'));
      reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
      reader.readAsDataURL(file);
    });
  }

  // Wholesale-replaces the current form/state with an AI-extracted proposal
  // (from a document import or an AI draft) -- this is a "start a new
  // proposal" action, not a merge, so any in-progress edits to the current
  // form are discarded.
  function loadImportedProposal(data) {
    state.editingId = null;
    state.clientId = null;
    state.paymentTermLines = [];

    el('clientName').value = (data.client && data.client.name) || '';
    el('propertyAddress').value = (data.client && data.client.address) || '';
    el('clientPhone').value = (data.client && data.client.phone) || '';
    el('clientEmail').value = (data.client && data.client.email) || '';
    el('proposalNum').value = data.proposalNum || String(Date.now()).slice(-4);
    el('proposalDate').value = new Date().toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
    el('timeline').value = '';
    el('notes').value = data.notes || '';
    el('totalLabel').value = '';
    el('investmentNote').value = '';
    el('expirationDate').value = '';
    el('termsAndConditions').value = '';
    el('paymentTermsToggle').checked = false;
    el('paymentTermsPanel').classList.add('is-hidden');

    state.sections = (data.sections || []).map((s) => {
      const { left, right } = splitSnippetItems(s.items || []);
      return {
        id: nextSectionId(),
        title: s.title || '',
        subtitle: '',
        price: Number(s.price) || 0,
        priceLabel: '',
        description: '',
        scopeStatus: null,
        leftScope: left,
        rightScope: right,
      };
    });
    state.clientSupplied = Array.isArray(data.clientSupplied) ? [...data.clientSupplied] : [];

    const indicator = el('editingIndicator');
    indicator.classList.add('is-hidden');
    el('generateBtn').textContent = 'Generate Word + PDF';
    el('saveAsNewBtn').classList.add('is-hidden');
    downloadLinks.innerHTML = '';
    el('clientMatchPanel').classList.add('is-hidden');

    renderRooms();
    renderClientSupplied();
    renderPaymentTermLines();
    recalcTotals();
    previewProposal();
  }

  el('importDocumentBtn').addEventListener('click', async () => {
    const fileInput = el('importDocumentInput');
    const statusEl = el('importDocumentStatus');
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      statusEl.textContent = 'Choose a file first.';
      statusEl.className = 'generate-status error';
      return;
    }

    statusEl.textContent = 'Reading file…';
    statusEl.className = 'generate-status';
    el('clientMatchPanel').classList.add('is-hidden');

    try {
      const isPdf = file.type === 'application/pdf';
      const fileBase64 = isPdf ? await readFileAsBase64(file) : await downscaleImageToBase64(file);
      const mediaType = isPdf ? 'application/pdf' : 'image/jpeg';
      statusEl.textContent = 'Importing and rewriting scope — this can take a minute…';
      const res = await fetch('/api/import-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64, mediaType }),
      });
      const body = await res.json();
      if (!res.ok) {
        statusEl.textContent = body.error || 'Import failed.';
        statusEl.className = 'generate-status error';
        return;
      }

      loadImportedProposal(body);
      renderClientMatches(body.matches);
      fileInput.value = '';
      statusEl.textContent = 'Imported — review pricing and scope before generating.';
      statusEl.className = 'generate-status';
    } catch (err) {
      statusEl.textContent = `Import failed: ${err.message}`;
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

  // ---- Custom notes library (user-managed, backed by fbpg_note_snippets) ----
  // Supplements the hardcoded SNIPPETS.notes list above with notes the user
  // adds themselves through the "Manage custom notes" panel, without needing
  // a code change. Loaded async on init and appended to the same dropdown.

  const notesSelect = el('notesSnippetSelect');
  const customNotesList = el('customNotesList');
  const customNoteItemTemplate = el('customNoteItemTemplate');
  const customNoteStatus = el('customNoteStatus');
  let customNotes = [];

  function setCustomNoteStatus(message, isError) {
    customNoteStatus.textContent = message || '';
    customNoteStatus.className = isError ? 'generate-status error' : 'generate-status';
  }

  function refreshCustomNoteOptions() {
    notesSelect.querySelectorAll('option.custom-note-option').forEach((opt) => opt.remove());
    for (const note of customNotes) {
      const opt = document.createElement('option');
      opt.className = 'custom-note-option';
      opt.value = note.text;
      opt.textContent = note.label;
      notesSelect.appendChild(opt);
    }
  }

  function renderCustomNotesList() {
    customNotesList.innerHTML = '';
    for (const note of customNotes) {
      const fragment = customNoteItemTemplate.content.cloneNode(true);
      const item = fragment.querySelector('.custom-note-item');
      const labelInput = item.querySelector('.custom-note-item-label');
      const textInput = item.querySelector('.custom-note-item-text');
      labelInput.value = note.label;
      textInput.value = note.text;

      item.querySelector('.custom-note-save').addEventListener('click', async () => {
        await saveCustomNote(note.id, labelInput.value, textInput.value);
      });
      item.querySelector('.custom-note-remove').addEventListener('click', async () => {
        await deleteCustomNote(note.id);
      });

      customNotesList.appendChild(item);
    }
  }

  async function loadCustomNotes() {
    try {
      const res = await fetch('/api/clients?resource=note-snippets');
      if (!res.ok) throw new Error('Could not load custom notes');
      const body = await res.json();
      customNotes = body.noteSnippets || [];
      renderCustomNotesList();
      refreshCustomNoteOptions();
    } catch (err) {
      setCustomNoteStatus(`Could not load custom notes: ${err.message}`, true);
    }
  }

  async function saveCustomNote(id, label, text) {
    if (!label.trim() || !text.trim()) {
      setCustomNoteStatus('Label and text are both required.', true);
      return;
    }
    try {
      const res = await fetch('/api/clients?resource=note-snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, label: label.trim(), text: text.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Save failed');
      setCustomNoteStatus(id ? 'Note updated.' : 'Note added.');
      await loadCustomNotes();
    } catch (err) {
      setCustomNoteStatus(`Could not save note: ${err.message}`, true);
    }
  }

  async function deleteCustomNote(id) {
    try {
      const res = await fetch(`/api/clients?resource=note-snippets&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Delete failed');
      setCustomNoteStatus('Note deleted.');
      await loadCustomNotes();
    } catch (err) {
      setCustomNoteStatus(`Could not delete note: ${err.message}`, true);
    }
  }

  el('addCustomNoteBtn').addEventListener('click', async () => {
    const labelInput = el('customNoteLabel');
    const textInput = el('customNoteText');
    await saveCustomNote(null, labelInput.value, textInput.value);
    if (!customNoteStatus.classList.contains('error')) {
      labelInput.value = '';
      textInput.value = '';
    }
  });

  // ---- Status library (user-managed, backed by fbpg_statuses) ---------------
  // Populates the Status dropdown from fbpg_statuses (seeded with the
  // default Draft/Sent/Pending/Sold/Lost pipeline stages) plus any custom
  // ones added through the "Manage statuses" panel.

  const statusSelect = el('proposalStatus');
  const customStatusList = el('customStatusList');
  const customStatusItemTemplate = el('customStatusItemTemplate');
  const customStatusStatus = el('customStatusStatus');
  let customStatuses = [];

  function setCustomStatusStatus(message, isError) {
    customStatusStatus.textContent = message || '';
    customStatusStatus.className = isError ? 'generate-status error' : 'generate-status';
  }

  function refreshStatusSelectOptions(selectedLabel) {
    const previous = selectedLabel ?? statusSelect.value;
    statusSelect.innerHTML = '';
    for (const status of customStatuses) {
      const opt = document.createElement('option');
      opt.value = status.label;
      opt.textContent = status.label;
      statusSelect.appendChild(opt);
    }
    statusSelect.value = previous || 'Sent';
  }

  function renderCustomStatusesList() {
    customStatusList.innerHTML = '';
    for (const status of customStatuses) {
      const fragment = customStatusItemTemplate.content.cloneNode(true);
      fragment.querySelector('.custom-status-item-label').textContent = status.label;
      fragment.querySelector('.custom-status-remove').addEventListener('click', async () => {
        await deleteCustomStatus(status.id);
      });
      customStatusList.appendChild(fragment);
    }
  }

  async function loadCustomStatuses(selectedLabel) {
    try {
      const res = await fetch('/api/clients?resource=statuses');
      if (!res.ok) throw new Error('Could not load statuses');
      const body = await res.json();
      customStatuses = body.statuses || [];
      renderCustomStatusesList();
      refreshStatusSelectOptions(selectedLabel);
    } catch (err) {
      setCustomStatusStatus(`Could not load statuses: ${err.message}`, true);
    }
  }

  async function saveCustomStatus(label) {
    if (!label.trim()) {
      setCustomStatusStatus('A status name is required.', true);
      return;
    }
    try {
      const res = await fetch('/api/clients?resource=statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Save failed');
      setCustomStatusStatus('Status added.');
      await loadCustomStatuses(label.trim());
    } catch (err) {
      setCustomStatusStatus(`Could not add status: ${err.message}`, true);
    }
  }

  async function deleteCustomStatus(id) {
    try {
      const res = await fetch(`/api/clients?resource=statuses&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Delete failed');
      setCustomStatusStatus('Status deleted.');
      await loadCustomStatuses();
    } catch (err) {
      setCustomStatusStatus(`Could not delete status: ${err.message}`, true);
    }
  }

  el('addCustomStatusBtn').addEventListener('click', async () => {
    const labelInput = el('customStatusLabel');
    await saveCustomStatus(labelInput.value);
    if (!customStatusStatus.classList.contains('error')) labelInput.value = '';
  });

  // ---- Chat-driven proposal edits (mode=edit) --------------------------------

  const CHAT_SIMPLE_FIELD_LABELS = {
    notes: 'Notes',
    termsAndConditions: 'Terms & Conditions',
    totalLabel: 'Total Label',
    investmentNote: 'Investment Note',
    expirationDate: 'Valid Until',
  };

  function truncateForChat(text, max) {
    const t = (text || '').trim();
    return t.length > max ? `${t.slice(0, max)}...` : t;
  }

  // Normalizes a proposal object down to exactly the fields the chat-edit
  // tool can change, in a fixed key order, so the "Other changes" fallback
  // below can compare oldData (a full collectProposalData() snapshot, with
  // extra fields like proposalNum/date/client the tool never returns) against
  // newData (the tool's minimal response shape) without those structural
  // differences alone making every response look changed.
  function chatEditableSubset(data) {
    return {
      sections: (data.sections || []).map((s) => ({
        title: s.title || '',
        subtitle: (s.subtitle || '').trim(),
        price: Number(s.price) || 0,
        priceLabel: s.priceLabel || '',
        hidePrice: !!s.hidePrice,
        leftScope: (s.leftScope || []).map((it) => ({ type: it.type, text: it.text })),
        rightScope: (s.rightScope || []).map((it) => ({ type: it.type, text: it.text })),
      })),
      notes: (data.notes || '').trim(),
      termsAndConditions: (data.termsAndConditions || '').trim(),
      totalLabel: (data.totalLabel || '').trim(),
      investmentNote: (data.investmentNote || '').trim(),
      expirationDate: (data.expirationDate || '').trim(),
      clientSupplied: data.clientSupplied || [],
      paymentTerms: data.paymentTerms || null,
    };
  }

  function diffProposalForChat(oldData, newData) {
    const changes = [];

    Object.keys(CHAT_SIMPLE_FIELD_LABELS).forEach((key) => {
      const oldVal = (oldData[key] || '').trim();
      const newVal = (newData[key] || '').trim();
      if (oldVal !== newVal) {
        changes.push(`${CHAT_SIMPLE_FIELD_LABELS[key]}: "${truncateForChat(oldVal, 60) || '(empty)'}" -> "${truncateForChat(newVal, 60) || '(empty)'}"`);
      }
    });

    const oldSupplied = oldData.clientSupplied || [];
    const newSupplied = newData.clientSupplied || [];
    newSupplied.filter((t) => !oldSupplied.includes(t)).forEach((t) => changes.push(`+ Client-supplied item: "${t}"`));
    oldSupplied.filter((t) => !newSupplied.includes(t)).forEach((t) => changes.push(`- Client-supplied item: "${t}"`));

    const oldSections = oldData.sections || [];
    const newSections = newData.sections || [];
    const oldTitles = oldSections.map((s) => s.title);
    const newTitles = newSections.map((s) => s.title);
    newTitles.filter((t) => !oldTitles.includes(t)).forEach((t) => changes.push(`+ Room added: "${t}"`));
    oldTitles.filter((t) => !newTitles.includes(t)).forEach((t) => changes.push(`- Room removed: "${t}"`));

    newSections.forEach((newSection) => {
      const oldSection = oldSections.find((s) => s.title === newSection.title);
      if (!oldSection) return;
      const oldPrice = Number(oldSection.price) || 0;
      const newPrice = Number(newSection.price) || 0;
      if (oldPrice !== newPrice) {
        changes.push(`${newSection.title} price: $${oldPrice.toLocaleString('en-US')} -> $${newPrice.toLocaleString('en-US')}`);
      }
      const oldSubtitle = (oldSection.subtitle || '').trim();
      const newSubtitle = (newSection.subtitle || '').trim();
      if (oldSubtitle !== newSubtitle) {
        changes.push(`${newSection.title} subtitle: "${oldSubtitle}" -> "${newSubtitle}"`);
      }
      const oldPriceLabel = (oldSection.priceLabel || '').trim();
      const newPriceLabel = (newSection.priceLabel || '').trim();
      if (oldPriceLabel !== newPriceLabel) {
        changes.push(`${newSection.title} priceLabel: "${oldPriceLabel}" -> "${newPriceLabel}"`);
      }
      if (!!oldSection.hidePrice !== !!newSection.hidePrice) {
        changes.push(`${newSection.title}: price ${newSection.hidePrice ? 'hidden' : 'shown'} on proposal`);
      }
      const oldBullets = [...(oldSection.leftScope || []), ...(oldSection.rightScope || [])].map((it) => it.text);
      const newBullets = [...(newSection.leftScope || []), ...(newSection.rightScope || [])].map((it) => it.text);
      newBullets.filter((t) => !oldBullets.includes(t)).forEach((t) => changes.push(`+ ${newSection.title}: "${t}"`));
      oldBullets.filter((t) => !newBullets.includes(t)).forEach((t) => changes.push(`- ${newSection.title}: "${t}"`));
    });

    const oldPT = oldData.paymentTerms;
    const newPT = newData.paymentTerms;
    if (!oldPT && newPT) {
      changes.push('+ Payment terms added');
    } else if (oldPT && !newPT) {
      changes.push('- Payment terms removed');
    } else if (oldPT && newPT) {
      const oldLineCount = (oldPT.lines || []).length;
      const newLineCount = (newPT.lines || []).length;
      if (oldLineCount !== newLineCount || (oldPT.note || '') !== (newPT.note || '')) {
        changes.push(`Payment terms changed (${newLineCount} line${newLineCount === 1 ? '' : 's'})`);
      }
    }

    if (!changes.length && JSON.stringify(chatEditableSubset(oldData)) !== JSON.stringify(chatEditableSubset(newData))) {
      changes.push('Other changes: ordering or formatting');
    }

    return changes;
  }

  function applyEditedProposal(newData) {
    el('notes').value = newData.notes || '';
    el('termsAndConditions').value = newData.termsAndConditions || '';
    el('totalLabel').value = newData.totalLabel || '';
    el('investmentNote').value = newData.investmentNote || '';
    el('expirationDate').value = newData.expirationDate || '';

    state.sections = (newData.sections || []).map((s) => ({
      id: nextSectionId(),
      title: s.title || '',
      subtitle: s.subtitle || '',
      price: Number(s.price) || 0,
      priceLabel: s.priceLabel || '',
      hidePrice: !!s.hidePrice,
      description: '',
      scopeStatus: null,
      leftScope: (s.leftScope || []).map((it) => ({ ...it })),
      rightScope: (s.rightScope || []).map((it) => ({ ...it })),
    }));
    state.clientSupplied = Array.isArray(newData.clientSupplied) ? [...newData.clientSupplied] : [];

    if (newData.paymentTerms && Array.isArray(newData.paymentTerms.lines)) {
      el('paymentTermsToggle').checked = true;
      el('paymentTermsPanel').classList.remove('is-hidden');
      state.paymentTermLines = newData.paymentTerms.lines.map((l) => ({ label: l.label || '', amount: l.amount || 0 }));
      el('paymentTermsNote').value = newData.paymentTerms.note || '';
    } else {
      el('paymentTermsToggle').checked = false;
      el('paymentTermsPanel').classList.add('is-hidden');
      state.paymentTermLines = [];
    }

    renderRooms();
    renderClientSupplied();
    renderPaymentTermLines();
    recalcTotals();
    schedulePreviewRefresh();
  }

  const chatInstructionEl = el('chatInstruction');
  const chatLogEl = el('chatLog');
  const chatEntryTemplate = el('chatEntryTemplate');
  const chatSendBtn = el('chatSendBtn');
  let pendingChatEntry = null;

  function createChatEntry(instructionText) {
    const fragment = chatEntryTemplate.content.cloneNode(true);
    const entry = fragment.querySelector('.chat-entry');
    entry.querySelector('.chat-entry-instruction').textContent = instructionText;
    chatLogEl.appendChild(entry);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
    return entry;
  }

  function setChatEntryNote(entry, text, isError) {
    const noteEl = entry.querySelector('.chat-entry-note');
    noteEl.textContent = text;
    noteEl.className = isError ? 'chat-entry-note error' : 'chat-entry-note';
  }

  function clearPendingChatEntry() {
    if (!pendingChatEntry) return;
    const entry = pendingChatEntry;
    entry.querySelector('.chat-entry-actions').innerHTML = '';
    entry.querySelector('.chat-entry-changes').innerHTML = '';
    pendingChatEntry = null;
    setChatEntryNote(entry, 'Superseded by a newer request.');
  }

  async function sendChatInstruction() {
    const instruction = chatInstructionEl.value.trim();
    if (!instruction) return;

    clearPendingChatEntry();

    const entry = createChatEntry(instruction);
    setChatEntryNote(entry, 'Thinking...');
    chatInstructionEl.value = '';

    chatSendBtn.disabled = true;
    chatInstructionEl.disabled = true;

    const snapshot = collectProposalData();
    try {
      const res = await fetch('/api/generate-full-proposal?mode=edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal: snapshot, instruction }),
      });
      const newData = await res.json();
      if (!res.ok) throw new Error(newData.details || newData.error || 'Edit failed');

      const changes = diffProposalForChat(snapshot, newData);
      if (!changes.length) {
        setChatEntryNote(entry, newData.message || 'No changes detected — try rephrasing.');
        return;
      }

      setChatEntryNote(entry, newData.message || '');
      const changesList = entry.querySelector('.chat-entry-changes');
      changes.forEach((c) => {
        const li = document.createElement('li');
        li.textContent = c;
        changesList.appendChild(li);
      });

      const actionsEl = entry.querySelector('.chat-entry-actions');
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn-add-small';
      applyBtn.textContent = 'Apply';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn-add-small';
      cancelBtn.textContent = 'Cancel';
      applyBtn.addEventListener('click', () => {
        applyEditedProposal(newData);
        actionsEl.innerHTML = '';
        changesList.innerHTML = '';
        setChatEntryNote(entry, 'Applied.');
        pendingChatEntry = null;
      });
      cancelBtn.addEventListener('click', () => {
        actionsEl.innerHTML = '';
        changesList.innerHTML = '';
        setChatEntryNote(entry, 'Cancelled.');
        pendingChatEntry = null;
      });
      actionsEl.appendChild(applyBtn);
      actionsEl.appendChild(cancelBtn);
      pendingChatEntry = entry;
    } catch (err) {
      setChatEntryNote(entry, `Could not apply edit: ${err.message}`, true);
    } finally {
      chatSendBtn.disabled = false;
      chatInstructionEl.disabled = false;
    }
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  chatSendBtn.addEventListener('click', sendChatInstruction);

  // ---- Rooms & Scope --------------------------------------------------------

  function addRoom() {
    const id = nextSectionId();
    state.sections.push({
      id, title: '', subtitle: '', price: 0, priceLabel: '', description: '', scopeStatus: null,
      // A room added while "Show total only" is on should stay hidden too.
      hidePrice: state.sections.length > 0 && state.sections.every((s) => s.hidePrice),
      leftScope: [], rightScope: [],
    });
    renderRooms();
  }

  async function generateScopeForRoom(sectionId, description, images) {
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
        body: JSON.stringify({ description, roomTitle: section.title, images }),
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

  // beforeIndex omitted (or out of range) appends at the end -- unchanged
  // default for the column-header "+ Label"/"+ Bullet" buttons. Passing an
  // index inserts there instead, pushing that item and everything after it
  // down one -- lets a bullet land anywhere in the column, not just at the
  // very end (used by the new inline "+" between every existing item, in
  // both the sidebar and the preview's own insert controls).
  function addScopeItem(sectionId, side, type, beforeIndex) {
    const section = state.sections.find((s) => s.id === sectionId);
    const arr = section[side === 'left' ? 'leftScope' : 'rightScope'];
    const item = { type, text: '' };
    if (typeof beforeIndex === 'number' && beforeIndex >= 0 && beforeIndex <= arr.length) {
      arr.splice(beforeIndex, 0, item);
    } else {
      arr.push(item);
    }
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

      const hidePriceInput = card.querySelector('.room-hide-price');
      hidePriceInput.checked = !!section.hidePrice;
      hidePriceInput.addEventListener('change', () => {
        section.hidePrice = hidePriceInput.checked;
        syncShowTotalOnlyToggle();
      });

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

      const layoutImageInput = card.querySelector('.room-layout-image');
      card.querySelector('.generate-scope-btn').addEventListener('click', async () => {
        const imageFiles = layoutImageInput.files ? Array.from(layoutImageInput.files) : [];
        if (imageFiles.length > MAX_ROOM_LAYOUT_IMAGES) {
          section.scopeStatus = { text: `No more than ${MAX_ROOM_LAYOUT_IMAGES} layout photos per generation.`, error: true };
          renderRooms();
          return;
        }
        const images = imageFiles.length ? await Promise.all(imageFiles.map(downscaleImageToBase64)) : undefined;
        layoutImageInput.value = '';
        generateScopeForRoom(section.id, descTextarea.value, images);
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
          itemFrag.querySelector('.scope-item-insert').addEventListener('click', () => addScopeItem(section.id, side, 'bullet', index));
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
    syncShowTotalOnlyToggle();
  }

  // "Show total only" isn't stored anywhere itself -- it's just a shortcut
  // that reads/sets every room's hidePrice, so a proposal can also hide
  // prices on only some rooms.
  function syncShowTotalOnlyToggle() {
    el('showTotalOnlyToggle').checked = state.sections.length > 0 && state.sections.every((s) => s.hidePrice);
  }

  el('showTotalOnlyToggle').addEventListener('change', (e) => {
    state.sections.forEach((s) => { s.hidePrice = e.target.checked; });
    renderRooms();
  });

  el('addRoomBtn').addEventListener('click', addRoom);

  // ---- Draft an entire proposal from one plain-language description ---------
  //
  // Appends AI-drafted rooms to whatever's already on the form (unlike the
  // document import, this doesn't reset the proposal) -- it's meant as a
  // fast starting point for a from-scratch proposal, one paragraph instead
  // of adding rooms and running "Generate Scope" one at a time.

  el('draftFullProposalBtn').addEventListener('click', async () => {
    const textarea = el('fullProjectDescription');
    const statusEl = el('fullProposalStatus');
    const description = textarea.value.trim();
    if (!description) {
      statusEl.textContent = 'Describe the project first.';
      statusEl.className = 'room-scope-status error';
      return;
    }

    statusEl.textContent = 'Drafting full proposal — this can take a minute…';
    statusEl.className = 'room-scope-status';

    try {
      const res = await fetch('/api/generate-full-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const body = await res.json();
      if (!res.ok) {
        statusEl.textContent = body.error || 'Drafting failed.';
        statusEl.className = 'room-scope-status error';
        return;
      }

      for (const s of body.sections || []) {
        const { left, right } = splitSnippetItems(s.items || []);
        state.sections.push({
          id: nextSectionId(),
          title: s.title || '',
          subtitle: '',
          price: Number(s.price) || 0,
          priceLabel: '',
          description: '',
          scopeStatus: null,
          leftScope: left,
          rightScope: right,
        });
      }
      if (body.notes) {
        const notesEl = el('notes');
        notesEl.value = notesEl.value.trim() ? `${notesEl.value.trim()}\n${body.notes}` : body.notes;
      }
      if (Array.isArray(body.clientSupplied)) {
        state.clientSupplied.push(...body.clientSupplied);
      }

      textarea.value = '';
      statusEl.textContent = body.priceRationale || 'Done — review pricing and scope before generating.';
      statusEl.className = 'room-scope-status';

      renderRooms();
      renderClientSupplied();
      recalcTotals();
      previewProposal();
    } catch (err) {
      statusEl.textContent = `Drafting failed: ${err.message}`;
      statusEl.className = 'room-scope-status error';
    }
  });

  // ---- Draft a full proposal from uploaded blueprint/plan files -------------
  //
  // Same append-to-current-state behavior as "Draft Full Proposal from
  // Description" above (not a reset like the document import) -- plans
  // don't carry client contact info the way an invoice/estimate does, so
  // there's no client-info payload to wholesale-replace the form with.

  const BLUEPRINT_MAX_FILES = 15;
  const BLUEPRINT_TOTAL_SIZE_CAP_BYTES = 18 * 1024 * 1024;
  const BLUEPRINT_ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

  let publicConfigPromise = null;
  function getPublicConfig() {
    if (!publicConfigPromise) {
      publicConfigPromise = fetch('/api/public-config')
        .then((res) => {
          if (!res.ok) throw new Error('Could not load Supabase config');
          return res.json();
        })
        .catch((err) => {
          publicConfigPromise = null;
          throw err;
        });
    }
    return publicConfigPromise;
  }

  async function uploadBlueprintFile(file, config) {
    const urlRes = await fetch('/api/blueprint-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, mimeType: file.type }),
    });
    const urlBody = await urlRes.json();
    if (!urlRes.ok) throw new Error(urlBody.error || `Could not get an upload URL for ${file.name}`);

    const putRes = await fetch(urlBody.signedUrl, {
      method: 'PUT',
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.supabaseAnonKey}`,
        'Content-Type': file.type,
      },
      body: file,
    });
    if (!putRes.ok) throw new Error(`Could not upload ${file.name}`);

    return urlBody.path;
  }

  el('draftFromBlueprintsBtn').addEventListener('click', async () => {
    const fileInput = el('blueprintFilesInput');
    const notesEl = el('blueprintNotes');
    const statusEl = el('blueprintDraftStatus');
    const files = Array.from(fileInput.files || []);

    if (!files.length) {
      statusEl.textContent = 'Choose at least one blueprint file first.';
      statusEl.className = 'generate-status error';
      return;
    }
    if (files.length > BLUEPRINT_MAX_FILES) {
      statusEl.textContent = `Choose ${BLUEPRINT_MAX_FILES} files or fewer.`;
      statusEl.className = 'generate-status error';
      return;
    }
    const badType = files.find((f) => !BLUEPRINT_ALLOWED_MIME_TYPES.includes(f.type));
    if (badType) {
      statusEl.textContent = `${badType.name} isn't a supported file type (PDF, JPEG, PNG, or WEBP).`;
      statusEl.className = 'generate-status error';
      return;
    }
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > BLUEPRINT_TOTAL_SIZE_CAP_BYTES) {
      statusEl.textContent = 'These files are too large combined. Upload just the relevant sheets (typically floor plans) or split into two passes.';
      statusEl.className = 'generate-status error';
      return;
    }
    if (notesEl.value.trim().length > 2000) {
      statusEl.textContent = 'Notes must be 2000 characters or fewer.';
      statusEl.className = 'generate-status error';
      return;
    }

    try {
      statusEl.textContent = 'Uploading blueprints…';
      statusEl.className = 'generate-status';
      const config = await getPublicConfig();

      const paths = [];
      for (let i = 0; i < files.length; i += 1) {
        statusEl.textContent = `Uploading ${i + 1} of ${files.length}…`;
        paths.push(await uploadBlueprintFile(files[i], config));
      }

      statusEl.textContent = 'Reading blueprints and drafting scope — this can take a minute…';
      const res = await fetch('/api/generate-budget-from-blueprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, notes: notesEl.value.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        statusEl.textContent = body.error || 'Drafting failed.';
        statusEl.className = 'generate-status error';
        return;
      }

      for (const s of body.sections || []) {
        const { left, right } = splitSnippetItems(s.items || []);
        state.sections.push({
          id: nextSectionId(),
          title: s.title || '',
          subtitle: '',
          price: Number(s.price) || 0,
          priceLabel: '',
          description: '',
          scopeStatus: null,
          leftScope: left,
          rightScope: right,
        });
      }
      if (body.notes) {
        const notesTextarea = el('notes');
        notesTextarea.value = notesTextarea.value.trim() ? `${notesTextarea.value.trim()}\n${body.notes}` : body.notes;
      }
      if (Array.isArray(body.clientSupplied)) {
        state.clientSupplied.push(...body.clientSupplied);
      }

      fileInput.value = '';
      notesEl.value = '';
      statusEl.textContent = body.priceRationale || 'Done — review pricing and scope before generating.';
      statusEl.className = 'generate-status';

      renderRooms();
      renderClientSupplied();
      recalcTotals();
      previewProposal();
    } catch (err) {
      statusEl.textContent = `Drafting failed: ${err.message}`;
      statusEl.className = 'generate-status error';
    }
  });

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
        hidePrice: s.hidePrice ? true : undefined,
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
      status: el('proposalStatus').value || 'Sent',
      depositAmount: el('depositAmount').value.trim() !== '' ? Number(el('depositAmount').value) : undefined,
      depositDate: el('depositDate').value.trim() || undefined,
      balanceDue: el('balanceDue').value.trim() !== '' ? Number(el('balanceDue').value) : undefined,
      paymentNotes: el('paymentNotes').value.trim() || undefined,
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
      refreshStatusSelectOptions(p.status || 'Sent');
      el('depositAmount').value = p.deposit_amount ?? '';
      el('depositDate').value = p.deposit_date || '';
      el('balanceDue').value = p.balance_due ?? '';
      el('paymentNotes').value = p.payment_notes || '';

      state.editingId = id;
      state.clientId = p.client_id ?? null;

      state.sections = (p.sections || []).map((s) => ({
        id: nextSectionId(),
        title: s.title || '',
        subtitle: s.subtitle || '',
        price: s.price || 0,
        priceLabel: s.priceLabel || '',
        hidePrice: !!s.hidePrice,
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

      showEditingState(id, p.proposal_num);

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
      case 'insert-bullet': {
        const section = state.sections[payload.section];
        if (section) addScopeItem(section.id, payload.side, 'bullet', payload.index);
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

  function showEditingState(id, proposalNum) {
    state.editingId = id;
    state.savedProposalNum = proposalNum;
    const indicator = el('editingIndicator');
    indicator.textContent = `Editing Proposal #${proposalNum}`;
    indicator.classList.remove('is-hidden');
    el('generateBtn').textContent = 'Save Changes';
    el('saveAsNewBtn').classList.remove('is-hidden');
  }

  // "1901" -> "1901-B", "1901-B" -> "1901-C", so an alternate version is
  // distinguishable on the history page and on the document itself.
  function nextVersionNum(num) {
    const m = num.match(/^(.*)-([A-Ya-y])$/);
    if (m) return `${m[1]}-${String.fromCharCode(m[2].toUpperCase().charCodeAt(0) + 1)}`;
    return `${num}-B`;
  }

  async function generateProposal(asNewVersion = false) {
    if (asNewVersion && el('proposalNum').value.trim() === state.savedProposalNum) {
      el('proposalNum').value = nextVersionNum(state.savedProposalNum);
    }
    const data = collectProposalData();
    if (asNewVersion) {
      // A new row, not an update -- and an alternate version hasn't been
      // paid on, so the original's deposit/balance tracking doesn't carry over.
      delete data.id;
      delete data.depositAmount;
      delete data.depositDate;
      delete data.balanceDue;
      delete data.paymentNotes;
    }
    const generateBtn = el('generateBtn');
    const saveAsNewBtn = el('saveAsNewBtn');
    generateBtn.disabled = true;
    saveAsNewBtn.disabled = true;
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
        if (asNewVersion) el('proposalNum').value = state.savedProposalNum;
        return;
      }
      generateStatus.textContent = 'Done.';
      if (!asNewVersion && state.editingId) showEditingState(state.editingId, data.proposalNum);
      if (asNewVersion && !body.id) {
        // Files were made but the history row wasn't -- don't leave the form
        // pointed at the original with the new version's number in it.
        generateStatus.textContent = 'Files generated, but the new version could not be saved to history.';
        generateStatus.className = 'generate-status error';
        el('proposalNum').value = state.savedProposalNum;
      } else if (asNewVersion) {
        // From here on, Save Changes updates the new version, not the original.
        generateStatus.textContent = `Saved as new version #${data.proposalNum}.`;
        showEditingState(body.id, data.proposalNum);
        history.replaceState(null, '', `?edit=${encodeURIComponent(body.id)}`);
        el('depositAmount').value = '';
        el('depositDate').value = '';
        el('balanceDue').value = '';
        el('paymentNotes').value = '';
      }
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
      if (asNewVersion) el('proposalNum').value = state.savedProposalNum;
    } finally {
      generateBtn.disabled = false;
      saveAsNewBtn.disabled = false;
    }
  }

  el('generateBtn').addEventListener('click', () => generateProposal(false));
  el('saveAsNewBtn').addEventListener('click', () => generateProposal(true));

  // ---- Wire up totals recompute + live preview sync on any input -------------

  document.addEventListener('input', recalcTotals);
  document.addEventListener('input', schedulePreviewRefresh);
  document.addEventListener('change', schedulePreviewRefresh);

  async function init() {
    populateSnippetSelects();
    loadCustomNotes();
    await loadCustomStatuses();
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
