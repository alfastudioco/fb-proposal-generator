// "Share PDF" -- on phones, hands the generated PDF to the system share sheet
// (Messages, Mail, ...) as an attached file instead of a link. Browsers that
// can't share files (most desktops) just open the PDF like Download does.
//
// iOS Safari only allows navigator.share() shortly after a tap, and fetching
// the PDF first can use that window up. If the share is refused for that
// reason, the fetched file is kept and the button asks for one more tap,
// which then shares immediately.
(function () {
  'use strict';

  function canShareFiles() {
    try {
      return !!(navigator.canShare && navigator.canShare({
        files: [new File([''], 'test.pdf', { type: 'application/pdf' })],
      }));
    } catch (err) {
      return false;
    }
  }

  function proposalFileName(proposalNum, clientName) {
    const parts = ['FB Construction Proposal'];
    if (proposalNum) parts.push(String(proposalNum));
    let name = parts.join(' ');
    if (clientName) name += ` - ${clientName}`;
    return `${name.replace(/[\\/:*?"<>|]+/g, '').trim()}.pdf`;
  }

  // getUrl: async () => signed PDF URL. Returns a <button>.
  function makeSharePdfButton({ getUrl, proposalNum, clientName, className, label = 'Share PDF' }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    let readyFile = null;

    async function share(file) {
      await navigator.share({ files: [file], title: file.name.replace(/\.pdf$/, '') });
    }

    btn.addEventListener('click', async () => {
      if (readyFile) {
        const file = readyFile;
        readyFile = null;
        btn.textContent = label;
        try { await share(file); } catch (err) { if (err.name !== 'AbortError') alert(`Could not share: ${err.message}`); }
        return;
      }

      btn.disabled = true;
      btn.textContent = '…';
      try {
        const url = await getUrl();
        if (!canShareFiles()) {
          window.open(url, '_blank');
          return;
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`download failed (${res.status})`);
        const blob = await res.blob();
        const file = new File([blob], proposalFileName(proposalNum, clientName), { type: 'application/pdf' });
        try {
          await share(file);
        } catch (err) {
          if (err.name === 'NotAllowedError') {
            readyFile = file;
            btn.disabled = false;
            btn.textContent = 'Tap to send';
            return;
          }
          if (err.name !== 'AbortError') throw err;
        }
      } catch (err) {
        alert(`Could not share PDF: ${err.message}`);
      } finally {
        if (!readyFile) {
          btn.disabled = false;
          btn.textContent = label;
        }
      }
    });
    return btn;
  }

  window.fbpgShare = { makeSharePdfButton, canShareFiles };
})();
