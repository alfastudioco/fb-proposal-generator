(function () {
  'use strict';

  const statusEl = document.getElementById('historyStatus');
  const bodyEl = document.getElementById('historyBody');

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

  function renderRow(proposal) {
    const tr = document.createElement('tr');

    const cells = [
      proposal.proposal_num,
      proposal.client_name,
      proposal.date,
      formatCurrency(proposal.total_amount),
      formatCreatedAt(proposal.created_at),
    ];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }

    const filesCell = document.createElement('td');
    filesCell.className = 'history-files';
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

  loadProposals();
})();
