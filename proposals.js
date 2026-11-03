(function () {
  'use strict';

  const statusEl = document.getElementById('historyStatus');
  const bodyEl = document.getElementById('historyBody');
  const HISTORY_COLUMN_COUNT = 8;

  let statusOptions = [];

  function formatCurrency(amount) {
    return `$${Math.round(amount || 0).toLocaleString('en-US')}`;
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

  // ---- Deposit/balance tracking -- summary text + an inline editor row
  // that expands below the proposal's row on demand.

  function depositSummaryText(proposal) {
    const parts = [];
    if (proposal.deposit_amount != null) parts.push(`Dep ${formatCurrency(proposal.deposit_amount)}`);
    if (proposal.balance_due != null) parts.push(`Bal ${formatCurrency(proposal.balance_due)}`);
    return parts.length ? parts.join(' · ') : '—';
  }

  function closeOpenDepositEditors() {
    document.querySelectorAll('.deposit-edit-row').forEach((row) => row.remove());
  }

  function toggleDepositEditor(proposal, tr, summaryEl) {
    const existing = tr.nextElementSibling;
    if (existing && existing.classList.contains('deposit-edit-row')) {
      existing.remove();
      return;
    }
    closeOpenDepositEditors();

    const editRow = document.createElement('tr');
    editRow.className = 'deposit-edit-row';
    const td = document.createElement('td');
    td.colSpan = HISTORY_COLUMN_COUNT;

    const form = document.createElement('div');
    form.className = 'deposit-edit-form';

    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.placeholder = 'Deposit amount';
    amountInput.value = proposal.deposit_amount ?? '';

    const dateInput = document.createElement('input');
    dateInput.type = 'text';
    dateInput.placeholder = 'Deposit date';
    dateInput.value = proposal.deposit_date || '';

    const balanceInput = document.createElement('input');
    balanceInput.type = 'number';
    balanceInput.placeholder = 'Balance due';
    balanceInput.value = proposal.balance_due ?? '';

    const notesInput = document.createElement('input');
    notesInput.type = 'text';
    notesInput.placeholder = 'Payment notes';
    notesInput.value = proposal.payment_notes || '';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn-file';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-file';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => editRow.remove());

    const editStatus = document.createElement('span');
    editStatus.className = 'deposit-edit-status';

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      editStatus.textContent = 'Saving…';
      const patch = {
        depositAmount: amountInput.value.trim() !== '' ? Number(amountInput.value) : null,
        depositDate: dateInput.value.trim() || null,
        balanceDue: balanceInput.value.trim() !== '' ? Number(balanceInput.value) : null,
        paymentNotes: notesInput.value.trim() || null,
      };
      try {
        await patchProposal(proposal.id, patch);
        Object.assign(proposal, {
          deposit_amount: patch.depositAmount,
          deposit_date: patch.depositDate,
          balance_due: patch.balanceDue,
          payment_notes: patch.paymentNotes,
        });
        summaryEl.textContent = depositSummaryText(proposal);
        editRow.remove();
      } catch (err) {
        editStatus.textContent = `Failed: ${err.message}`;
        saveBtn.disabled = false;
      }
    });

    form.appendChild(amountInput);
    form.appendChild(dateInput);
    form.appendChild(balanceInput);
    form.appendChild(notesInput);
    form.appendChild(saveBtn);
    form.appendChild(cancelBtn);
    form.appendChild(editStatus);

    td.appendChild(form);
    editRow.appendChild(td);
    tr.after(editRow);
  }

  function buildDepositCell(proposal, tr) {
    const td = document.createElement('td');
    td.className = 'history-deposit';
    td.dataset.label = 'Deposit';

    const summary = document.createElement('span');
    summary.className = 'deposit-summary';
    summary.textContent = depositSummaryText(proposal);
    td.appendChild(summary);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-file deposit-edit-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => toggleDepositEditor(proposal, tr, summary));
    td.appendChild(editBtn);

    return td;
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

    tr.appendChild(buildDepositCell(proposal, tr));

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

  async function loadProposals() {
    statusEl.textContent = 'Loading…';
    statusEl.className = 'history-status';
    try {
      const res = await fetch('/api/proposals');
      const body = await res.json();
      if (!res.ok) throw new Error(body.details || body.error);

      bodyEl.innerHTML = '';
      if (!body.proposals.length) {
        statusEl.textContent = 'No proposals generated yet.';
        return;
      }
      statusEl.textContent = '';
      for (const proposal of body.proposals) {
        bodyEl.appendChild(renderRow(proposal));
      }
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
