(function () {
  'use strict';

  const statusEl = document.getElementById('historyStatus');
  const bodyEl = document.getElementById('historyBody');
  const HISTORY_COLUMN_COUNT = 8;

  let statusOptions = [];

  // Whole dollars, unless there are cents (a $1,234.50 payment).
  function formatCurrency(amount) {
    const n = Math.round((Number(amount) || 0) * 100) / 100;
    const cents = Number.isInteger(n) ? 0 : 2;
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: cents, maximumFractionDigits: cents })}`;
  }

  function formatCreatedAt(iso) {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }

  async function getFileUrl(id, type) {
    const res = await fetch(`/api/proposal-link?id=${encodeURIComponent(id)}&type=${type}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.details || body.error);
    return body.url;
  }

  async function downloadFile(id, type, buttonEl) {
    const originalText = buttonEl.textContent;
    buttonEl.textContent = '…';
    buttonEl.disabled = true;
    // Open the tab during the tap: mobile Safari blocks window.open() once
    // an await has happened, so open it blank now and point it at the file.
    const win = window.open('', '_blank');
    try {
      const url = await getFileUrl(id, type);
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (err) {
      if (win) win.close();
      alert(`Could not get download link: ${err.message}`);
    } finally {
      buttonEl.textContent = originalText;
      buttonEl.disabled = false;
    }
  }

  async function patchProposal(id, patch) {
    const res = await fetch(`/api/proposals?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.details || body.error || 'Update failed');
    return body.proposal;
  }

  // ---- Status dropdown (backed by fbpg_statuses, same list index.html's
  // "Manage statuses" panel manages) -- updates via PATCH, no doc regen.

  function buildStatusCell(proposal) {
    const td = document.createElement('td');
    td.className = 'history-status-cell';
    td.dataset.label = 'Status';
    const select = document.createElement('select');
    select.className = 'history-status-select';
    for (const status of statusOptions) {
      const opt = document.createElement('option');
      opt.value = status.label;
      opt.textContent = status.label;
      select.appendChild(opt);
    }
    select.value = proposal.status || 'Sent';

    select.addEventListener('change', async () => {
      const previous = proposal.status;
      select.disabled = true;
      try {
        await patchProposal(proposal.id, { status: select.value });
        proposal.status = select.value;
        render(); // refresh tab counts; the row moves to its new tab
      } catch (err) {
        alert(`Could not update status: ${err.message}`);
        select.value = previous || 'Sent';
      } finally {
        select.disabled = false;
      }
    });

    td.appendChild(select);
    return td;
  }

  // ---- Payments (fbpg_payments) -- the Payments column shows what's paid
  // and what's still owed; its button opens an inline panel below the row
  // to record, fix or delete payments. Balance due is never stored: it's
  // always the proposal total minus the payments, so re-pricing a proposal
  // updates it by itself.

  const PAYMENT_METHODS = ['Check', 'Zelle', 'Card', 'Cash', 'Other'];

  function paymentTotals(proposal) {
    const payments = proposal.payments || [];
    const paid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const total = Number(proposal.total_amount) || 0;
    return { payments, paid, total, balance: Math.round((total - paid) * 100) / 100 };
  }

  function sortPayments(payments) {
    return payments.slice().sort((a, b) =>
      String(a.paid_on).localeCompare(String(b.paid_on)) || String(a.created_at).localeCompare(String(b.created_at)));
  }

  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatPaidOn(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return String(iso || '');
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async function paymentRequest(method, query, payload) {
    const res = await fetch(`/api/proposals?resource=payments${query}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.details || body.error || 'Payment request failed');
    return body.payments;
  }

  function closeOpenDepositEditors() {
    document.querySelectorAll('.deposit-edit-row').forEach((row) => row.remove());
  }

  // Fills the Payments cell: "$51,000 due · $40,000 paid" + progress bar,
  // "Paid in full", or "No payments", plus the button that opens the panel.
  function fillPaymentsCell(td, proposal, tr) {
    td.innerHTML = '';
    const { payments, paid, total, balance } = paymentTotals(proposal);

    const summary = document.createElement('div');
    summary.className = 'payments-cell-summary';
    if (!payments.length) {
      const none = document.createElement('span');
      none.className = 'payments-none';
      none.textContent = 'No payments';
      summary.appendChild(none);
    } else if (balance > 0) {
      const due = document.createElement('span');
      due.className = 'payments-due';
      due.textContent = `${formatCurrency(balance)} due`;
      const paidEl = document.createElement('span');
      paidEl.className = 'payments-paid';
      paidEl.textContent = `${formatCurrency(paid)} paid`;
      summary.appendChild(due);
      summary.appendChild(paidEl);
    } else {
      const pif = document.createElement('span');
      pif.className = 'payments-pif';
      pif.textContent = balance < 0 ? `✓ Paid in full · ${formatCurrency(-balance)} credit` : '✓ Paid in full';
      summary.appendChild(pif);
    }
    if (payments.length) {
      const bar = document.createElement('div');
      bar.className = 'payments-bar' + (balance <= 0 ? ' is-done' : '');
      const fill = document.createElement('i');
      fill.style.width = `${total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 100}%`;
      bar.appendChild(fill);
      summary.appendChild(bar);
    }
    td.appendChild(summary);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-file payments-btn';
    btn.textContent = payments.length ? 'Payments' : '+ Payment';
    btn.addEventListener('click', () => togglePaymentsPanel(proposal, tr));
    td.appendChild(btn);

    const filesStatus = document.createElement('div');
    filesStatus.className = 'payments-files-status';
    filesStatus.dataset.proposalId = proposal.id;
    paintFilesStatus(filesStatus, filesStatusById.get(proposal.id));
    td.appendChild(filesStatus);
  }

  // ---- Keep the PDF/Word current with the payments ------------------------
  // After any payment change, the proposal's files are remade server-side
  // (POST /api/generate?regenerate=<id>) so the copy you download or share
  // shows the current Paid / Balance Due lines. One run at a time per
  // proposal; changes made during a run trigger one more run afterwards, so
  // the last file made always includes every payment.

  const filesStatusById = new Map(); // id -> { text, kind }
  const regenRuns = new Map(); // id -> { running, again }

  function paintFilesStatus(el, status) {
    el.textContent = status ? status.text : '';
    el.className = `payments-files-status${status && status.kind ? ` is-${status.kind}` : ''}`;
  }

  function setFilesStatus(id, text, kind) {
    const status = text ? { text, kind } : null;
    if (status) filesStatusById.set(id, status); else filesStatusById.delete(id);
    document.querySelectorAll('.payments-files-status').forEach((el) => {
      if (el.dataset.proposalId === id) paintFilesStatus(el, status);
    });
  }

  async function regenerateFiles(id) {
    const run = regenRuns.get(id) || { running: false, again: false };
    regenRuns.set(id, run);
    if (run.running) {
      run.again = true;
      return;
    }
    run.running = true;
    try {
      do {
        run.again = false;
        setFilesStatus(id, 'Updating PDF & Word…', 'busy');
        const res = await fetch(`/api/generate?regenerate=${encodeURIComponent(id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.details || body.error || `HTTP ${res.status}`);
      } while (run.again);
      setFilesStatus(id, 'PDF & Word updated ✓', 'ok');
      setTimeout(() => {
        const current = filesStatusById.get(id);
        if (current && current.kind === 'ok') setFilesStatus(id, '');
      }, 6000);
    } catch (err) {
      setFilesStatus(id, `PDF not updated: ${err.message}`, 'error');
    } finally {
      run.running = false;
    }
  }

  function buildPaymentsCell(proposal, tr) {
    const td = document.createElement('td');
    td.className = 'history-payments';
    td.dataset.label = 'Payments';
    fillPaymentsCell(td, proposal, tr);
    return td;
  }

  function togglePaymentsPanel(proposal, tr) {
    const existing = tr.nextElementSibling;
    if (existing && existing.classList.contains('payments-row')) {
      existing.remove();
      return;
    }
    closeOpenDepositEditors();

    // Shares .deposit-edit-row so only one inline editor is open at a time.
    const panelRow = document.createElement('tr');
    panelRow.className = 'deposit-edit-row payments-row';
    const td = document.createElement('td');
    td.colSpan = HISTORY_COLUMN_COUNT;
    const panel = document.createElement('div');
    panel.className = 'payments-panel';
    td.appendChild(panel);
    panelRow.appendChild(td);
    tr.after(panelRow);

    let editingId = null; // payment being fixed, or null when recording a new one

    // ---- Record / edit form (built once, reused for edits)
    const form = document.createElement('form');
    form.className = 'payment-form';
    form.noValidate = true;

    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.inputMode = 'decimal';
    amountInput.min = '0';
    amountInput.step = '0.01';
    amountInput.placeholder = '$ Amount';
    amountInput.className = 'payment-amount';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'payment-date';
    dateInput.value = todayIso();

    const methodWrap = document.createElement('div');
    methodWrap.className = 'payment-methods';
    let method = 'Check';
    const methodBtns = PAYMENT_METHODS.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'payment-method';
      b.textContent = m;
      b.addEventListener('click', () => setMethod(m));
      methodWrap.appendChild(b);
      return b;
    });
    function setMethod(m) {
      method = PAYMENT_METHODS.includes(m) ? m : 'Other';
      methodBtns.forEach((b) => b.classList.toggle('is-active', b.textContent === method));
    }
    setMethod('Check');

    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = "Note (check #, what it's for)";
    noteInput.className = 'payment-note';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn-record-payment';

    const cancelEditBtn = document.createElement('button');
    cancelEditBtn.type = 'button';
    cancelEditBtn.className = 'btn-file';
    cancelEditBtn.textContent = 'Cancel edit';
    cancelEditBtn.addEventListener('click', () => { resetForm(); renderPanel(); });

    const formStatus = document.createElement('div');
    formStatus.className = 'deposit-edit-status payment-form-status';

    form.append(amountInput, dateInput, methodWrap, noteInput, submitBtn, cancelEditBtn, formStatus);

    function resetForm() {
      editingId = null;
      amountInput.value = '';
      dateInput.value = todayIso();
      noteInput.value = '';
      setMethod('Check');
      submitBtn.textContent = '+ Record payment';
      cancelEditBtn.classList.add('is-hidden');
      form.classList.remove('is-editing');
      formStatus.textContent = '';
    }

    function startEdit(payment) {
      editingId = payment.id;
      amountInput.value = payment.amount;
      dateInput.value = payment.paid_on;
      noteInput.value = payment.note || '';
      setMethod(payment.method || 'Other');
      submitBtn.textContent = 'Save changes';
      cancelEditBtn.classList.remove('is-hidden');
      form.classList.add('is-editing');
      formStatus.textContent = `Editing the ${formatCurrency(payment.amount)} payment from ${formatPaidOn(payment.paid_on)}`;
      renderPanel();
      amountInput.focus();
    }

    function setBusy(busy) {
      panel.querySelectorAll('button, input').forEach((x) => { x.disabled = busy; });
    }

    async function apply(action, busyText) {
      setBusy(true);
      formStatus.textContent = busyText;
      try {
        proposal.payments = sortPayments(await action());
        regenerateFiles(proposal.id); // background; status shows in the Payments cell
        fillPaymentsCell(tr.querySelector('.history-payments'), proposal, tr);
        setBusy(false);
        resetForm();
        renderPanel();
        return true;
      } catch (err) {
        setBusy(false);
        formStatus.textContent = `Failed: ${err.message}`;
        return false;
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = Number(amountInput.value);
      if (!Number.isFinite(amount) || amount <= 0) {
        formStatus.textContent = 'Enter the amount paid.';
        amountInput.focus();
        return;
      }
      if (!dateInput.value) {
        formStatus.textContent = 'Pick the date it was paid.';
        dateInput.focus();
        return;
      }
      const payload = { amount, paidOn: dateInput.value, method, note: noteInput.value.trim() };
      if (editingId) {
        const id = editingId;
        apply(() => paymentRequest('PATCH', `&id=${encodeURIComponent(id)}`, payload), 'Saving…');
      } else {
        apply(() => paymentRequest('POST', '', { ...payload, proposalId: proposal.id }), 'Recording…');
      }
    });

    // ---- Panel: totals, notes, payment list, then the form
    function renderPanel() {
      const { payments, paid, total, balance } = paymentTotals(proposal);
      panel.innerHTML = '';

      const sums = document.createElement('div');
      sums.className = 'payments-totals';
      const balanceLabel = balance < 0 ? 'Credit' : 'Balance due';
      for (const [label, value, cls] of [
        ['Total', total, ''],
        ['Paid', paid, ''],
        [balanceLabel, Math.abs(balance), balance > 0 ? ' is-due' : ' is-clear'],
      ]) {
        const box = document.createElement('div');
        box.className = 'payments-total' + cls;
        const l = document.createElement('div');
        l.className = 'payments-total-label';
        l.textContent = label;
        const v = document.createElement('div');
        v.className = 'payments-total-value';
        v.textContent = formatCurrency(value);
        box.append(l, v);
        sums.appendChild(box);
      }
      panel.appendChild(sums);

      if (proposal.payment_notes) {
        const notes = document.createElement('div');
        notes.className = 'payments-notes';
        notes.textContent = proposal.payment_notes;
        panel.appendChild(notes);
      }

      if (payments.length) {
        const list = document.createElement('div');
        list.className = 'payments-list';
        for (const p of payments) {
          const item = document.createElement('div');
          item.className = 'payment-item' + (p.id === editingId ? ' is-editing' : '');
          const when = document.createElement('span');
          when.className = 'payment-item-date';
          when.textContent = formatPaidOn(p.paid_on);
          const how = document.createElement('span');
          how.className = 'payment-item-method';
          how.textContent = p.method || '—';
          const note = document.createElement('span');
          note.className = 'payment-item-note';
          note.textContent = p.note || '';
          const amt = document.createElement('span');
          amt.className = 'payment-item-amount';
          amt.textContent = formatCurrency(p.amount);
          const actions = document.createElement('span');
          actions.className = 'payment-item-actions';
          const editBtn = document.createElement('button');
          editBtn.type = 'button';
          editBtn.className = 'link-btn';
          editBtn.textContent = 'Edit';
          editBtn.addEventListener('click', () => startEdit(p));
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'link-btn is-danger';
          delBtn.textContent = 'Delete';
          delBtn.addEventListener('click', () => {
            if (!confirm(`Delete the ${formatCurrency(p.amount)} payment from ${formatPaidOn(p.paid_on)}?`)) return;
            apply(() => paymentRequest('DELETE', `&id=${encodeURIComponent(p.id)}`), 'Deleting…');
          });
          actions.append(editBtn, delBtn);
          item.append(when, how, note, amt, actions);
          list.appendChild(item);
        }
        panel.appendChild(list);
      }

      panel.appendChild(form);

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'link-btn payments-close';
      close.textContent = 'Close';
      close.addEventListener('click', () => panelRow.remove());
      panel.appendChild(close);
    }

    resetForm();
    renderPanel();
    amountInput.focus();
  }

  // ---- Linked client (fbpg_clients) -- shows the linked client's name, or a
  // "Link client" button for proposals saved before the client database
  // existed or whose name alone wasn't enough to match. Linking only sets
  // client_id; the proposal's own client snapshot and its files stay as-is.

  function buildClientCell(proposal, tr) {
    const td = document.createElement('td');
    td.className = 'history-client';
    td.dataset.label = 'Client';

    const name = document.createElement('span');
    name.className = 'history-client-name' + (proposal.client ? '' : ' is-unlinked');
    name.textContent = proposal.client ? proposal.client.name : proposal.client_name;
    td.appendChild(name);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-file history-client-btn';
    btn.textContent = proposal.client ? 'Change' : 'Link client';
    btn.addEventListener('click', () => toggleClientEditor(proposal, tr));
    td.appendChild(btn);

    return td;
  }

  async function saveClientLink(proposal, client, tr) {
    const updated = await patchProposal(proposal.id, { clientId: client ? client.id : null });
    proposal.client_id = updated.client_id;
    proposal.client = updated.client;
    closeOpenDepositEditors();
    tr.replaceChild(buildClientCell(proposal, tr), tr.querySelector('.history-client'));
  }

  function makeButton(text, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-file';
    btn.textContent = text;
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }

  function toggleClientEditor(proposal, tr) {
    const existing = tr.nextElementSibling;
    if (existing && existing.classList.contains('client-edit-row')) {
      existing.remove();
      return;
    }
    closeOpenDepositEditors();

    // Shares .deposit-edit-row so closeOpenDepositEditors keeps one editor
    // open at a time across both kinds.
    const editRow = document.createElement('tr');
    editRow.className = 'deposit-edit-row client-edit-row';
    const td = document.createElement('td');
    td.colSpan = HISTORY_COLUMN_COUNT;

    const form = document.createElement('div');
    form.className = 'deposit-edit-form';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'client-link-search';
    searchInput.placeholder = 'Search saved clients by name, address, phone or email';
    searchInput.value = proposal.client ? '' : (proposal.client_name || '');

    const editStatus = document.createElement('span');
    editStatus.className = 'deposit-edit-status';

    const results = document.createElement('div');
    results.className = 'client-link-results';

    // "+ New client" form, prefilled from the proposal's own client details.
    const newForm = document.createElement('div');
    newForm.className = 'deposit-edit-form client-link-new is-hidden';
    const fields = {};
    for (const [key, placeholder] of [['name', 'Client name'], ['address', 'Address'], ['phone', 'Phone'], ['email', 'Email']]) {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = placeholder;
      input.value = proposal[`client_${key}`] || '';
      fields[key] = input;
      newForm.appendChild(input);
    }

    function setBusy(busy, text) {
      editStatus.textContent = text;
      td.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
    }

    async function run(action, label) {
      setBusy(true, label);
      try {
        await action();
      } catch (err) {
        setBusy(false, `Failed: ${err.message}`);
      }
    }

    function renderResults(clients, q) {
      results.innerHTML = '';
      if (!clients.length) {
        const empty = document.createElement('div');
        empty.className = 'client-suggest-empty';
        empty.textContent = q ? `No saved clients match "${q}" — use + New client.` : 'No saved clients yet — use + New client.';
        results.appendChild(empty);
        return;
      }
      for (const client of clients) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'client-suggest-item';
        const n = document.createElement('span');
        n.className = 'client-suggest-name';
        n.textContent = client.name + (proposal.client_id === client.id ? ' (linked)' : '');
        item.appendChild(n);
        const detail = [client.address, client.phone, client.email].filter(Boolean).join(' · ');
        if (detail) {
          const d = document.createElement('span');
          d.className = 'client-suggest-detail';
          d.textContent = detail;
          item.appendChild(d);
        }
        item.addEventListener('click', () => run(() => saveClientLink(proposal, client, tr), 'Linking…'));
        results.appendChild(item);
      }
    }

    let searchSeq = 0;
    let searchTimer = null;
    async function search() {
      const q = searchInput.value.trim();
      const seq = ++searchSeq;
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(q)}`);
        const body = await res.json();
        if (seq !== searchSeq) return; // a newer keystroke's search owns the list
        if (!res.ok) throw new Error(body.details || body.error);
        renderResults((body.clients || []).slice(0, 8), q);
      } catch (err) {
        if (seq === searchSeq) results.textContent = `Search failed: ${err.message}`;
      }
    }
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(search, 200);
    });

    const createBtn = makeButton('Save & link', () => {
      if (!fields.name.value.trim()) {
        editStatus.textContent = 'Client name is required.';
        return;
      }
      run(async () => {
        const res = await fetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: fields.name.value, address: fields.address.value, phone: fields.phone.value, email: fields.email.value,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.details || body.error || 'Could not save client');
        await saveClientLink(proposal, body.client, tr);
      }, 'Saving…');
    });
    newForm.appendChild(createBtn);

    form.appendChild(searchInput);
    form.appendChild(makeButton('+ New client', () => {
      newForm.classList.toggle('is-hidden');
      if (!newForm.classList.contains('is-hidden')) fields.name.focus();
    }));
    if (proposal.client) {
      form.appendChild(makeButton('Unlink', () => run(() => saveClientLink(proposal, null, tr), 'Unlinking…')));
    }
    form.appendChild(makeButton('Cancel', () => editRow.remove()));
    form.appendChild(editStatus);

    td.appendChild(form);
    td.appendChild(newForm);
    td.appendChild(results);
    editRow.appendChild(td);
    tr.after(editRow);
    searchInput.focus();
    search();
  }

  function renderRow(proposal) {
    const tr = document.createElement('tr');

    const numTd = document.createElement('td');
    numTd.className = 'history-num';
    numTd.dataset.label = 'Proposal #';
    numTd.textContent = proposal.proposal_num;
    tr.appendChild(numTd);

    tr.appendChild(buildClientCell(proposal, tr));

    tr.appendChild(buildStatusCell(proposal));

    const dateTd = document.createElement('td');
    dateTd.className = 'history-date';
    dateTd.dataset.label = 'Date';
    dateTd.textContent = proposal.date;
    tr.appendChild(dateTd);

    const totalTd = document.createElement('td');
    totalTd.className = 'history-total';
    totalTd.dataset.label = 'Total';
    totalTd.textContent = formatCurrency(proposal.total_amount);
    tr.appendChild(totalTd);

    tr.appendChild(buildPaymentsCell(proposal, tr));

    const createdTd = document.createElement('td');
    createdTd.className = 'history-created';
    createdTd.dataset.label = 'Created';
    createdTd.textContent = formatCreatedAt(proposal.created_at);
    tr.appendChild(createdTd);

    const filesCell = document.createElement('td');
    filesCell.className = 'history-files';
    const editLink = document.createElement('a');
    editLink.className = 'btn-file';
    editLink.textContent = 'Edit';
    editLink.href = `/?edit=${encodeURIComponent(proposal.id)}`;
    filesCell.appendChild(editLink);
    const docxBtn = document.createElement('button');
    docxBtn.type = 'button';
    docxBtn.className = 'btn-file';
    docxBtn.textContent = 'Word';
    docxBtn.addEventListener('click', () => downloadFile(proposal.id, 'docx', docxBtn));
    const pdfBtn = document.createElement('button');
    pdfBtn.type = 'button';
    pdfBtn.className = 'btn-file';
    pdfBtn.textContent = 'PDF';
    pdfBtn.addEventListener('click', () => downloadFile(proposal.id, 'pdf', pdfBtn));
    filesCell.appendChild(docxBtn);
    filesCell.appendChild(pdfBtn);
    // Phones get a Share button that attaches the PDF to a text or email.
    if (window.fbpgShare && window.fbpgShare.canShareFiles()) {
      filesCell.appendChild(window.fbpgShare.makeSharePdfButton({
        getUrl: () => getFileUrl(proposal.id, 'pdf'),
        proposalNum: proposal.proposal_num,
        clientName: proposal.client ? proposal.client.name : proposal.client_name,
        className: 'btn-file btn-share',
        label: 'Share PDF',
      }));
    }
    tr.appendChild(filesCell);

    return tr;
  }

  async function loadStatusOptions() {
    try {
      const res = await fetch('/api/clients?resource=statuses');
      const body = await res.json();
      if (res.ok) statusOptions = body.statuses || [];
    } catch (err) {
      console.error('Could not load statuses:', err);
    }
  }

  const filterInput = document.getElementById('proposalFilter');
  let proposals = [];

  // Client-side search over everything already loaded: linked client name,
  // the proposal's own client snapshot, proposal #, status and project label.
  function matchesFilter(p, q) {
    if (!q) return true;
    const text = [
      p.client && p.client.name, p.client_name, p.client_address, p.client_phone, p.client_email,
      p.proposal_num, p.status, p.total_label,
    ].filter(Boolean).join(' ').toLowerCase();
    if (text.includes(q)) return true;
    const digits = q.replace(/\D/g, '');
    return digits.length >= 3 && String(p.client_phone || '').replace(/\D/g, '').includes(digits);
  }

  // ---- Status tabs: All + every status in fbpg_statuses (plus any status a
  // proposal carries that's no longer in that list), each with a count.
  // Counts follow the search box so they always match what a tab will show.
  const tabsEl = document.getElementById('statusTabs');
  const params = new URLSearchParams(window.location.search);
  let activeStatus = params.get('status') || 'All';

  // $3,600 · $86.9K · $2.1M — short enough to sit under a tab label.
  function compactCurrency(amount) {
    const n = Math.round(amount || 0);
    if (n < 10000) return formatCurrency(n);
    const short = (value, decimals) => String(parseFloat(value.toFixed(decimals)));
    if (n < 999500) return `$${short(n / 1000, n < 100000 ? 1 : 0)}K`;
    return `$${short(n / 1000000, n < 10000000 ? 2 : 1)}M`;
  }

  function statusOf(p) {
    return p.status || 'Sent';
  }

  function renderTabs(searched) {
    const labels = statusOptions.map((s) => s.label);
    for (const p of proposals) {
      if (!labels.includes(statusOf(p))) labels.push(statusOf(p));
    }
    if (activeStatus !== 'All' && !labels.includes(activeStatus)) activeStatus = 'All';

    tabsEl.innerHTML = '';
    for (const label of ['All', ...labels]) {
      const inTab = label === 'All' ? searched : searched.filter((p) => statusOf(p) === label);
      const count = inTab.length;
      const dollars = inTab.reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'status-tab' + (label === activeStatus ? ' is-active' : '') + (count ? '' : ' is-empty');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(label === activeStatus));
      const name = document.createElement('span');
      name.textContent = label;
      const num = document.createElement('span');
      num.className = 'status-tab-count';
      num.textContent = count;
      const top = document.createElement('span');
      top.className = 'status-tab-top';
      top.appendChild(name);
      top.appendChild(num);
      const money = document.createElement('span');
      money.className = 'status-tab-total';
      money.textContent = compactCurrency(dollars);
      money.title = formatCurrency(dollars);
      btn.appendChild(top);
      btn.appendChild(money);
      btn.addEventListener('click', () => {
        activeStatus = label;
        const url = new URL(window.location.href);
        if (label === 'All') url.searchParams.delete('status');
        else url.searchParams.set('status', label);
        history.replaceState(null, '', url);
        render();
      });
      tabsEl.appendChild(btn);
    }
    // Phones scroll the tab row sideways; keep the selected tab on screen.
    const active = tabsEl.querySelector('.status-tab.is-active');
    if (active && tabsEl.scrollWidth > tabsEl.clientWidth) {
      tabsEl.scrollLeft = active.offsetLeft - (tabsEl.clientWidth - active.offsetWidth) / 2;
    }
  }

  function render() {
    const raw = filterInput.value.trim();
    const q = raw.toLowerCase();
    const searched = proposals.filter((p) => matchesFilter(p, q));
    renderTabs(searched);
    const shown = activeStatus === 'All' ? searched : searched.filter((p) => statusOf(p) === activeStatus);
    bodyEl.innerHTML = '';
    for (const proposal of shown) bodyEl.appendChild(renderRow(proposal));
    statusEl.className = 'history-status';
    const where = activeStatus === 'All' ? '' : ` in ${activeStatus}`;
    if (!proposals.length) statusEl.textContent = 'No proposals generated yet.';
    else if (!shown.length) statusEl.textContent = q ? `No proposals${where} match "${raw}".` : `No proposals${where} yet.`;
    else statusEl.textContent = q ? `${shown.length} match${shown.length === 1 ? '' : 'es'}${where}` : '';
  }

  // The main page's "See all matches" link arrives with ?q=.
  filterInput.value = params.get('q') || '';
  filterInput.addEventListener('input', render);

  async function loadProposals() {
    statusEl.textContent = 'Loading…';
    statusEl.className = 'history-status';
    try {
      const res = await fetch('/api/proposals');
      const body = await res.json();
      if (!res.ok) throw new Error(body.details || body.error);
      proposals = body.proposals || [];
      render();
    } catch (err) {
      statusEl.textContent = `Failed to load proposals: ${err.message}`;
      statusEl.className = 'history-status error';
    }
  }

  (async function start() {
    await loadStatusOptions();
    await loadProposals();
  })();
})();
