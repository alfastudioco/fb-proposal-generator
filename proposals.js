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

  async function downloadFile(id, type, buttonEl) {
    const originalText = buttonEl.textContent;
    buttonEl.textContent = '…';
    buttonEl.disabled = true;
    try {
      const res = await fetch(`/api/proposal-link?id=${encodeURIComponent(id)}&type=${type}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.details || body.error);
      window.open(body.url, '_blank');
    } catch (err) {
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

  function renderRow(proposal) {
    const tr = document.createElement('tr');

    const numTd = document.createElement('td');
    numTd.textContent = proposal.proposal_num;
    tr.appendChild(numTd);

    const clientTd = document.createElement('td');
    clientTd.textContent = proposal.client_name;
    tr.appendChild(clientTd);

    tr.appendChild(buildStatusCell(proposal));

    const dateTd = document.createElement('td');
    dateTd.textContent = proposal.date;
    tr.appendChild(dateTd);

    const totalTd = document.createElement('td');
    totalTd.textContent = formatCurrency(proposal.total_amount);
    tr.appendChild(totalTd);

    tr.appendChild(buildDepositCell(proposal, tr));

    const createdTd = document.createElement('td');
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
