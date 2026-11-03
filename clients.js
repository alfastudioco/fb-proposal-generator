(function () {
  'use strict';

  // Clients page -- add, edit and delete fbpg_clients rows by hand, and see
  // each client's proposals. Proposals are matched to clients by client_id
  // from the same /api/proposals list the Past Proposals page uses.

  const statusEl = document.getElementById('clientsStatus');
  const bodyEl = document.getElementById('clientsBody');
  const filterInput = document.getElementById('clientFilter');
  const COLUMN_COUNT = 6;
  const FIELDS = [['name', 'Client name'], ['address', 'Address'], ['phone', 'Phone'], ['email', 'Email']];

  let clients = [];
  let proposalsByClient = new Map();

  function formatCurrency(amount) {
    return `$${Math.round(amount || 0).toLocaleString('en-US')}`;
  }

  function makeButton(text, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-file';
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  async function api(url, options) {
    const res = await fetch(url, options);
    const body = await res.json();
    if (!res.ok) throw new Error(body.details || body.error || 'Request failed');
    return body;
  }

  function saveClient(fields) {
    return api('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    }).then((body) => body.client);
  }

  function closeOpenEditors() {
    document.querySelectorAll('.deposit-edit-row').forEach((row) => row.remove());
  }

  // One inline form for both Add (client = null, inserted at the top) and
  // Edit (inserted below the client's row).
  function openClientForm(client, afterRow) {
    closeOpenEditors();
    const editRow = document.createElement('tr');
    editRow.className = 'deposit-edit-row';
    const td = document.createElement('td');
    td.colSpan = COLUMN_COUNT;
    const form = document.createElement('div');
    form.className = 'deposit-edit-form';

    const inputs = {};
    for (const [key, placeholder] of FIELDS) {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = placeholder;
      input.value = (client && client[key]) || '';
      inputs[key] = input;
      form.appendChild(input);
    }

    const editStatus = document.createElement('span');
    editStatus.className = 'deposit-edit-status';

    const saveBtn = makeButton(client ? 'Save' : 'Add client', async () => {
      if (!inputs.name.value.trim()) {
        editStatus.textContent = 'Client name is required.';
        return;
      }
      saveBtn.disabled = true;
      editStatus.textContent = 'Saving…';
      try {
        const fields = {};
        for (const [key] of FIELDS) fields[key] = inputs[key].value;
        if (client) fields.id = client.id;
        const saved = await saveClient(fields);
        clients = client ? clients.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...clients];
        render();
      } catch (err) {
        editStatus.textContent = `Failed: ${err.message}`;
        saveBtn.disabled = false;
      }
    });

    form.appendChild(saveBtn);
    form.appendChild(makeButton('Cancel', () => editRow.remove()));
    form.appendChild(editStatus);
    td.appendChild(form);
    editRow.appendChild(td);

    if (afterRow) afterRow.after(editRow);
    else bodyEl.prepend(editRow);
    inputs.name.focus();
  }

  async function deleteClient(client) {
    const count = (proposalsByClient.get(client.id) || []).length;
    const warning = count
      ? `Delete ${client.name}? Their ${count} proposal(s) will be kept but no longer linked to a client.`
      : `Delete ${client.name}?`;
    if (!window.confirm(warning)) return;
    try {
      await api(`/api/clients?id=${encodeURIComponent(client.id)}`, { method: 'DELETE' });
      clients = clients.filter((c) => c.id !== client.id);
      proposalsByClient.delete(client.id);
      render();
    } catch (err) {
      alert(`Could not delete client: ${err.message}`);
    }
  }

  function toggleProposals(client, tr) {
    const existing = tr.nextElementSibling;
    if (existing && existing.classList.contains('client-proposals-row')) {
      existing.remove();
      return;
    }
    closeOpenEditors();
    const row = document.createElement('tr');
    row.className = 'deposit-edit-row client-proposals-row';
    const td = document.createElement('td');
    td.colSpan = COLUMN_COUNT;
    const list = document.createElement('ul');
    list.className = 'client-proposals-list';
    for (const p of proposalsByClient.get(client.id) || []) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = `/?edit=${encodeURIComponent(p.id)}`;
      link.textContent = `#${p.proposal_num}`;
      li.appendChild(link);
      li.appendChild(document.createTextNode(` — ${p.date} · ${formatCurrency(p.total_amount)} · ${p.status || 'Sent'}`));
      list.appendChild(li);
    }
    td.appendChild(list);
    row.appendChild(td);
    tr.after(row);
  }

  function renderRow(client) {
    const tr = document.createElement('tr');
    for (const [key, label] of FIELDS) {
      const td = document.createElement('td');
      td.className = `client-${key}`;
      td.dataset.label = label.replace('Client name', 'Name');
      td.textContent = client[key] || '—';
      tr.appendChild(td);
    }

    const countTd = document.createElement('td');
    countTd.className = 'client-count';
    countTd.dataset.label = 'Proposals';
    const count = (proposalsByClient.get(client.id) || []).length;
    if (count) {
      countTd.appendChild(makeButton(`${count} ▾`, () => toggleProposals(client, tr)));
    } else {
      countTd.textContent = '0';
    }
    tr.appendChild(countTd);

    const actions = document.createElement('td');
    actions.className = 'history-files';
    actions.appendChild(makeButton('Edit', () => openClientForm(client, tr)));
    actions.appendChild(makeButton('Delete', () => deleteClient(client)));
    tr.appendChild(actions);
    return tr;
  }

  function matchesFilter(client, q) {
    if (!q) return true;
    const digits = q.replace(/\D/g, '');
    const text = [client.name, client.address, client.phone, client.email].filter(Boolean).join(' ').toLowerCase();
    if (text.includes(q)) return true;
    return digits.length >= 3 && String(client.phone || '').replace(/\D/g, '').includes(digits);
  }

  function render() {
    const q = filterInput.value.trim().toLowerCase();
    const shown = clients.filter((c) => matchesFilter(c, q));
    bodyEl.innerHTML = '';
    for (const client of shown) bodyEl.appendChild(renderRow(client));
    statusEl.className = 'history-status';
    if (!clients.length) statusEl.textContent = 'No clients yet — use + Add Client.';
    else if (!shown.length) statusEl.textContent = `No clients match "${filterInput.value.trim()}".`;
    else statusEl.textContent = `${shown.length} client(s)`;
  }

  async function load() {
    statusEl.textContent = 'Loading…';
    try {
      const [clientBody, proposalBody] = await Promise.all([
        api('/api/clients?all=1'),
        api('/api/proposals'),
      ]);
      clients = clientBody.clients || [];
      proposalsByClient = new Map();
      for (const p of proposalBody.proposals || []) {
        if (!p.client_id) continue;
        if (!proposalsByClient.has(p.client_id)) proposalsByClient.set(p.client_id, []);
        proposalsByClient.get(p.client_id).push(p);
      }
      render();
    } catch (err) {
      statusEl.textContent = `Failed to load clients: ${err.message}`;
      statusEl.className = 'history-status error';
    }
  }

  filterInput.addEventListener('input', render);
  document.getElementById('addClientBtn').addEventListener('click', () => openClientForm(null, null));

  load();
})();
