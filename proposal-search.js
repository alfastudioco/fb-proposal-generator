// Main-page "Find a proposal" search: type a client name, address, phone,
// email or proposal # and pick a past proposal to open it in the editor.
(function () {
  'use strict';

  const input = document.getElementById('proposalSearch');
  const list = document.getElementById('proposalSearchResults');
  if (!input || !list) return;

  const MAX_RESULTS = 8;
  let proposals = null; // loaded on first use
  let loading = null;
  let activeIndex = -1;

  function formatCurrency(amount) {
    return `$${Math.round(amount || 0).toLocaleString('en-US')}`;
  }

  function clientName(p) {
    return (p.client && p.client.name) || p.client_name || 'Unnamed client';
  }

  function matches(p, q) {
    const text = [
      p.client && p.client.name, p.client_name, p.client_address, p.client_phone, p.client_email,
      p.proposal_num, p.status, p.total_label,
    ].filter(Boolean).join(' ').toLowerCase();
    if (text.includes(q)) return true;
    const digits = q.replace(/\D/g, '');
    return digits.length >= 3 && String(p.client_phone || '').replace(/\D/g, '').includes(digits);
  }

  function load() {
    if (!loading) {
      loading = fetch('/api/proposals')
        .then((res) => res.json().then((body) => {
          if (!res.ok) throw new Error(body.details || body.error);
          proposals = body.proposals || [];
        }))
        .catch((err) => { loading = null; throw err; });
    }
    return loading;
  }

  function hide() {
    list.classList.add('is-hidden');
    activeIndex = -1;
  }

  function message(text) {
    list.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'client-suggest-empty';
    div.textContent = text;
    list.appendChild(div);
    list.classList.remove('is-hidden');
  }

  function render() {
    const raw = input.value.trim();
    if (!raw) { hide(); return; }
    if (!proposals) { message('Loading…'); return; }
    const q = raw.toLowerCase();
    const found = proposals.filter((p) => matches(p, q));
    list.innerHTML = '';
    activeIndex = -1;
    if (!found.length) { message(`No proposals match "${raw}".`); return; }

    for (const p of found.slice(0, MAX_RESULTS)) {
      const a = document.createElement('a');
      a.className = 'client-suggest-item';
      a.href = `/?edit=${encodeURIComponent(p.id)}`;
      const name = document.createElement('span');
      name.className = 'client-suggest-name';
      name.textContent = `${clientName(p)} — #${p.proposal_num}`;
      a.appendChild(name);
      const detail = document.createElement('span');
      detail.className = 'client-suggest-detail';
      detail.textContent = [p.date, formatCurrency(p.total_amount), p.status, p.client_address].filter(Boolean).join(' · ');
      a.appendChild(detail);
      list.appendChild(a);
    }

    const all = document.createElement('a');
    all.className = 'client-suggest-item proposal-search-all';
    all.href = `/proposals.html?q=${encodeURIComponent(raw)}`;
    all.textContent = found.length > MAX_RESULTS
      ? `See all ${found.length} matches →`
      : 'Open in Past Proposals →';
    list.appendChild(all);
    list.classList.remove('is-hidden');
  }

  function onInput() {
    if (!input.value.trim()) { hide(); return; }
    if (proposals) { render(); return; }
    render(); // shows "Loading…"
    load().then(render, (err) => message(`Could not load proposals: ${err.message}`));
  }

  input.addEventListener('focus', () => { load().catch(() => {}); if (input.value.trim()) onInput(); });
  input.addEventListener('input', onInput);

  input.addEventListener('keydown', (e) => {
    const items = Array.from(list.querySelectorAll('a.client-suggest-item'));
    if (e.key === 'Escape') { hide(); return; }
    if (!items.length || list.classList.contains('is-hidden')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('is-active', i === activeIndex));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      window.location.href = (items[activeIndex] || items[0]).href;
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.proposal-search')) hide();
  });
})();
