// Hone content script — self-contained (no ES module imports; communicates
// with the service worker via chrome.runtime.sendMessage).

(function honeBoot() {
  'use strict';
  if (window.__honeLoaded) return;
  window.__honeLoaded = true;

  // ── Privacy ──────────────────────────────────────────────────────────────

  const SENSITIVE_AUTOCOMPLETE = new Set([
    'current-password', 'new-password', 'cc-number', 'cc-csc',
    'cc-exp', 'cc-exp-month', 'cc-exp-year', 'one-time-code',
  ]);

  const SENSITIVE_PATTERNS = [
    /card[-_.\s]?num/i, /cvv/i, /cvc/i, /\bssn\b/i, /social[-_.\s]?sec/i,
    /\botp\b/i, /one[-_.\s]?time/i, /api[-_.\s]?key/i, /\bsecret\b/i,
    /\btoken\b/i, /passw(or)?d/i,
  ];

  const DEFAULT_DENIED_HOSTS = [
    '1password.com', 'bitwarden.com', 'lastpass.com', 'dashlane.com',
    'keepass.io', 'nordpass.com', 'keeper.io',
    'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com',
    'schwab.com', 'fidelity.com',
  ];

  function isFieldExcluded(el) {
    if (!el) return true;
    if (el.tagName === 'INPUT' && el.type === 'password') return true;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase().trim();
    if (SENSITIVE_AUTOCOMPLETE.has(ac)) return true;
    const labels = [el.name, el.id, el.getAttribute('aria-label'), el.placeholder].join(' ');
    return SENSITIVE_PATTERNS.some((p) => p.test(labels));
  }

  function isOriginDenied(hostname, denyList, allowList) {
    if (allowList.some((a) => hostname.includes(a))) return false;
    return [...DEFAULT_DENIED_HOSTS, ...denyList].some((d) => hostname.includes(d));
  }

  // Luhn check for credit card numbers
  function luhn(str) {
    const d = str.replace(/\D/g, '');
    let sum = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let v = parseInt(d[i], 10);
      if (alt) { v *= 2; if (v > 9) v -= 9; }
      sum += v; alt = !alt;
    }
    return sum % 10 === 0;
  }

  function scanContent(text) {
    const cards = text.match(/\b(?:\d[ -]?){13,19}\b/g) || [];
    for (const m of cards) {
      const d = m.replace(/\D/g, '');
      if (d.length >= 13 && d.length <= 19 && luhn(d))
        return { blocked: true, reason: 'Credit card number detected' };
    }
    if (/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/.test(text))
      return { blocked: true, reason: 'SSN pattern detected' };
    if (/[A-Za-z0-9_\-]{40,}/.test(text))
      return { blocked: true, reason: 'API key or secret token detected' };
    return { blocked: false };
  }

  function redact(text) {
    if (!text) return text;
    return text
      .replace(/\b(?:\d[ -]?){13,19}\b/g, '[CARD]')
      .replace(/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, '[SSN]')
      .replace(/[A-Za-z0-9_\-]{40,}/g, '[TOKEN]');
  }

  // ── Field helpers ─────────────────────────────────────────────────────────

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
    if (el.tagName === 'INPUT') {
      const t = (el.type || '').toLowerCase();
      return ['text', 'email', 'search', 'url', 'tel', ''].includes(t)
        && !el.disabled && !el.readOnly;
    }
    return el.isContentEditable;
  }

  function getFieldText(el) {
    return el.isContentEditable ? el.innerText : el.value;
  }

  function setFieldText(el, text) {
    if (el.isContentEditable) {
      el.focus();
      // selectAll + insertText works in Gmail, Notion, and most contenteditable surfaces
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    } else {
      // Use the native setter so React's synthetic event system picks up the change
      const proto = Object.getPrototypeOf(el);
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) nativeSetter.call(el, text); else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function detectMedium() {
    const h = location.hostname;
    if (h.includes('mail.google'))  return 'email (Gmail)';
    if (h.includes('slack.com'))    return 'Slack message';
    if (h.includes('linkedin.com')) return 'LinkedIn message';
    if (h.includes('twitter.com') || h.includes('x.com')) return 'social post';
    if (h.includes('notion.so'))    return 'Notion document';
    if (h.includes('docs.google'))  return 'Google Doc';
    if (h.includes('outlook') || h.includes('office'))  return 'email (Outlook)';
    return 'web text field';
  }

  // ── Floating trigger button ───────────────────────────────────────────────

  let activeField = null;
  let triggerBtn  = null;

  function ensureButton() {
    if (triggerBtn) return triggerBtn;
    triggerBtn = document.createElement('button');
    triggerBtn.setAttribute('aria-label', 'Hone: improve this text (Alt+H)');
    Object.assign(triggerBtn.style, {
      position:     'fixed',
      zIndex:       '2147483646',
      width:        '26px',
      height:       '26px',
      borderRadius: '6px',
      background:   '#1a1a2e',
      color:        '#fff',
      border:       'none',
      cursor:       'pointer',
      fontSize:     '12px',
      fontWeight:   '700',
      fontFamily:   'system-ui, sans-serif',
      lineHeight:   '1',
      boxShadow:    '0 2px 8px rgba(0,0,0,0.3)',
      display:      'none',
      alignItems:   'center',
      justifyContent: 'center',
      padding:      '0',
      userSelect:   'none',
    });
    triggerBtn.textContent = 'H';
    triggerBtn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // don't steal focus from the field
      e.stopPropagation();
      triggerHone();
    });
    document.body.appendChild(triggerBtn);
    return triggerBtn;
  }

  function positionButton(field) {
    if (!triggerBtn) return;
    const r = field.getBoundingClientRect();
    triggerBtn.style.top  = `${Math.max(r.bottom - 30, 4)}px`;
    triggerBtn.style.left = `${Math.max(r.right  - 30, 4)}px`;
  }

  function showButton(field) {
    const btn = ensureButton();
    positionButton(field);
    btn.style.display = 'flex';
  }

  function hideButton() {
    if (triggerBtn) triggerBtn.style.display = 'none';
  }

  // ── Focus tracking ────────────────────────────────────────────────────────

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!isEditable(el) || isFieldExcluded(el)) return;
    chrome.storage.local.get(['settings'], ({ settings }) => {
      const deny  = settings?.denyList  || [];
      const allow = settings?.allowList || [];
      if (isOriginDenied(location.hostname, deny, allow)) return;
      activeField = el;
      showButton(el);
    });
  }, true);

  document.addEventListener('focusout', () => {
    // Delay so a click on the button doesn't vanish it before the handler fires
    setTimeout(() => {
      const focused = document.activeElement;
      if (!focused || !isEditable(focused)) hideButton();
    }, 200);
  }, true);

  window.addEventListener('scroll', () => {
    if (activeField) positionButton(activeField);
    positionPanel();
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (activeField) positionButton(activeField);
    positionPanel();
  });

  // ── Hotkey: Alt+H ────────────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'h') {
      const field = activeField || (isEditable(document.activeElement) ? document.activeElement : null);
      if (field) { e.preventDefault(); triggerHone(); }
    }
  });

  // ── Core trigger ─────────────────────────────────────────────────────────

  let currentState = {};

  function triggerHone() {
    const field = activeField || (isEditable(document.activeElement) ? document.activeElement : null);
    if (!field) return;

    const text = getFieldText(field).trim();
    if (!text) { showPanel({ error: 'The field is empty — type something first.' }); return; }

    const scan = scanContent(text);
    if (scan.blocked) {
      showPanel({ error: `Blocked: ${scan.reason}. Hone will not send this to the API.` });
      return;
    }

    activeField    = field;
    currentState   = { text, field, iterations: [] };

    chrome.storage.local.get(['settings'], ({ settings }) => {
      const register = settings?.defaultRegister || 'professional';
      currentState.register = register;
      showPanel({ loading: true, register });
      requestRewrite(text, register, null);
    });
  }

  function requestRewrite(text, register, steeringNote) {
    const medium = detectMedium();
    chrome.runtime.sendMessage(
      { type: 'REWRITE', payload: { text, register, medium, steeringNote } },
      (res) => {
        if (chrome.runtime.lastError) {
          showPanel({ register, error: chrome.runtime.lastError.message }); return;
        }
        if (res?.error) {
          showPanel({ register, error: res.error }); return;
        }
        currentState.result   = res;
        currentState.register = register;
        showPanel({ result: res, register });
      }
    );
  }

  // ── Shadow DOM panel ──────────────────────────────────────────────────────

  const PANEL_CSS = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    #panel {
      position: fixed;
      z-index: 2147483647;
      width: 370px;
      max-height: 85vh; /* overridden dynamically by positionPanel */
      background: #ffffff;
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13.5px;
      color: #1a1a2e;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── header ── */
    .hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #1a1a2e;
      flex-shrink: 0;
      gap: 8px;
    }
    .hdr-left { display: flex; align-items: center; gap: 8px; }
    .logo { font-weight: 800; font-size: 14px; color: #fff; letter-spacing: 0.3px; }

    select.reg {
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.22);
      color: #fff;
      border-radius: 5px;
      padding: 3px 7px;
      font-size: 11.5px;
      cursor: pointer;
      outline: none;
      font-family: inherit;
    }
    select.reg option { background: #1a1a2e; }

    .close {
      background: none; border: none; color: rgba(255,255,255,0.6);
      cursor: pointer; font-size: 20px; line-height: 1; padding: 2px 4px;
      border-radius: 4px; font-family: inherit;
    }
    .close:hover { background: rgba(255,255,255,0.12); color: #fff; }

    /* ── scrollable body ── */
    .body {
      overflow-y: auto;
      flex: 1;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* ── loading ── */
    .loading {
      display: flex; align-items: center; justify-content: center;
      gap: 10px; color: #777; padding: 24px 0;
    }
    .spinner {
      width: 17px; height: 17px;
      border: 2px solid #e0e0e0;
      border-top-color: #1a1a2e;
      border-radius: 50%;
      animation: spin 0.65s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── error ── */
    .err {
      background: #fff5f5; border: 1px solid #fecaca;
      border-radius: 8px; padding: 11px 13px;
      color: #dc2626; font-size: 13px; line-height: 1.5;
    }

    /* ── no-change ── */
    .ok-box {
      background: #f0fdf4; border: 1px solid #bbf7d0;
      border-radius: 8px; padding: 11px 13px;
      color: #166534; font-size: 13px; line-height: 1.5;
    }

    /* ── section label ── */
    .lbl {
      font-size: 10px; font-weight: 700; letter-spacing: 0.9px;
      text-transform: uppercase; color: #aaa; margin-bottom: 5px;
    }

    /* ── rewrite textarea ── */
    .rewrite {
      width: 100%; min-height: 72px;
      background: #f0f4ff; border: 1.5px solid #c7d4f7;
      border-radius: 8px; padding: 10px 12px;
      font-size: 13.5px; font-family: inherit; line-height: 1.6;
      color: #1a1a2e; outline: none; resize: vertical;
    }
    .rewrite:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,0.12); }

    /* ── changes ── */
    .changes { display: flex; flex-direction: column; gap: 9px; }
    .change { border-left: 3px solid #6366f1; padding-left: 10px; }
    .change-title { font-weight: 600; font-size: 13px; color: #1a1a2e; }
    .change-why { font-size: 12px; color: #555; margin-top: 2px; line-height: 1.45; }

    /* ── verdict ── */
    .verdict {
      border-radius: 8px; padding: 9px 11px;
      font-size: 12px; line-height: 1.45;
    }
    .verdict.issue  { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; }
    .verdict.good   { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }

    /* ── steer ── */
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .chip {
      background: #f3f4f6; border: 1px solid #e5e7eb;
      border-radius: 100px; padding: 3px 11px;
      font-size: 11.5px; cursor: pointer; color: #374151;
      transition: background 0.1s; user-select: none;
    }
    .chip:hover { background: #e5e7eb; }

    .steer-in {
      width: 100%; border: 1.5px solid #e0e0e0;
      border-radius: 7px; padding: 8px 11px;
      font-size: 13px; font-family: inherit;
      outline: none; color: #1a1a2e;
    }
    .steer-in:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,0.1); }
    .steer-in::placeholder { color: #bbb; }

    /* ── footer ── */
    .footer {
      display: flex; gap: 8px;
      padding: 11px 14px; border-top: 1px solid #f0f0f0;
      flex-shrink: 0;
    }
    .btn {
      flex: 1; padding: 9px; border-radius: 8px;
      font-size: 13.5px; font-weight: 500; cursor: pointer;
      border: none; font-family: inherit; transition: opacity 0.13s;
    }
    .btn:hover  { opacity: 0.85; }
    .btn:active { opacity: 0.7; }
    .btn-reject { background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb; }
    .btn-accept { background: #1a1a2e; color: #fff; }
  `;

  let panelHost = null;
  let shadow    = null;

  function showPanel(state) {
    removePanel();
    panelHost = document.createElement('div');
    document.body.appendChild(panelHost);
    shadow = panelHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'panel';
    shadow.appendChild(panel);

    renderPanel(state);
    positionPanel();
  }

  function renderPanel(state) {
    const panel = shadow.getElementById('panel');
    if (!panel) return;

    const reg = state.register || currentState.register || 'professional';

    panel.innerHTML = `
      <div class="hdr">
        <div class="hdr-left">
          <span class="logo">Hone</span>
          <select class="reg" id="reg">
            ${['professional','concise','diplomatic','confident'].map((r) =>
              `<option value="${r}" ${reg === r ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`
            ).join('')}
          </select>
        </div>
        <button class="close" id="close" aria-label="Close">×</button>
      </div>

      <div class="body" id="body">${renderBody(state)}</div>

      ${renderFooter(state)}
    `;

    wirePanel(state, reg);
  }

  function renderBody(state) {
    if (state.loading) {
      return `<div class="loading"><div class="spinner"></div>Improving your message…</div>`;
    }
    if (state.error) {
      return `<div class="err">${esc(state.error)}</div>`;
    }
    if (!state.result) return '';

    const r = state.result;
    const noChange = !r.changes?.length;

    if (noChange) {
      return `<div class="ok-box">✓ ${esc(r.verdict || 'Original is already strong — no changes needed.')}</div>`;
    }

    const verdictClass = r.verdict?.toLowerCase().includes('fine') || r.verdict?.toLowerCase().includes('strong') ? 'good' : 'issue';

    return `
      <div>
        <div class="lbl">Rewrite</div>
        <textarea class="rewrite" id="rewrite" rows="4">${esc(r.rewrite)}</textarea>
      </div>

      <div>
        <div class="lbl">What changed</div>
        <div class="changes">
          ${(r.changes || []).map((c) => `
            <div class="change">
              <div class="change-title">${esc(c.change)}</div>
              <div class="change-why">${esc(c.reason)}</div>
            </div>
          `).join('')}
        </div>
      </div>

      ${r.verdict ? `<div class="verdict ${verdictClass}">${esc(r.verdict)}</div>` : ''}

      <div>
        <div class="lbl">Steer it</div>
        <div class="chips">
          ${['too stiff','too formal','make it warmer','keep my opening','shorter','more direct'].map((s) =>
            `<span class="chip" data-steer="${esc(s)}">${esc(s)}</span>`
          ).join('')}
        </div>
        <input class="steer-in" id="steer" type="text" placeholder="Type a note and press Enter…"/>
      </div>
    `;
  }

  function renderFooter(state) {
    if (state.loading) return '';
    if (state.error)   return `<div class="footer"><button class="btn btn-reject" id="dismiss">Dismiss</button></div>`;
    if (!state.result) return '';

    const noChange = !state.result.changes?.length;
    if (noChange) return `<div class="footer"><button class="btn btn-reject" id="dismiss">Dismiss</button></div>`;

    return `
      <div class="footer">
        <button class="btn btn-reject" id="btn-reject">Reject</button>
        <button class="btn btn-accept" id="btn-accept">Accept →</button>
      </div>`;
  }

  function wirePanel(state, reg) {
    const get = (id) => shadow.getElementById(id);

    // close
    get('close')?.addEventListener('click', removePanel);
    get('dismiss')?.addEventListener('click', removePanel);

    // register change — re-run with same text, new register
    get('reg')?.addEventListener('change', (e) => {
      const newReg = e.target.value;
      currentState.register = newReg;
      showPanel({ loading: true, register: newReg });
      requestRewrite(currentState.text, newReg, null);
    });

    // accept
    get('btn-accept')?.addEventListener('click', () => {
      const rewriteEl = get('rewrite');
      const finalText = rewriteEl ? rewriteEl.value : state.result.rewrite;
      if (currentState.field) setFieldText(currentState.field, finalText);
      logInteraction({
        original:   currentState.text,
        rewrite:    state.result.rewrite,
        finalText:  finalText !== state.result.rewrite ? finalText : undefined,
        outcome:    finalText !== state.result.rewrite ? 'edited' : 'accepted',
        register:   reg,
        changes:    state.result.changes,
        medium:     detectMedium(),
        iterations: currentState.iterations,
      });
      removePanel();
    });

    // reject
    get('btn-reject')?.addEventListener('click', () => {
      logInteraction({
        original: currentState.text, rewrite: state.result.rewrite,
        outcome: 'rejected', register: reg, changes: state.result.changes,
        medium: detectMedium(), iterations: currentState.iterations,
      });
      removePanel();
    });

    // steer chips
    shadow.querySelectorAll('.chip[data-steer]').forEach((chip) => {
      chip.addEventListener('click', () => steer(chip.dataset.steer, state, reg));
    });

    // steer input
    const steerIn = get('steer');
    if (steerIn) {
      steerIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const note = steerIn.value.trim();
          if (note) { steer(note, state, reg); steerIn.value = ''; }
        }
      });
    }
  }

  function steer(instruction, _prevState, reg) {
    if (!currentState.result) return;
    const beforeText = currentState.result.rewrite || currentState.text;
    currentState.iterations.push({ instruction, before: beforeText });
    showPanel({ loading: true, register: reg });
    requestRewrite(beforeText, reg, instruction);
  }

  function positionPanel() {
    const panel = shadow?.getElementById('panel');
    if (!panel) return;

    const vw  = window.innerWidth;
    const vh  = window.innerHeight;
    const PW  = 370;
    const GAP = 8;

    let top, left, maxH;

    if (activeField) {
      const r = activeField.getBoundingClientRect();
      const spaceBelow = vh - r.bottom - GAP * 2;
      const spaceAbove = r.top  - GAP * 2;

      if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
        // Enough room below — place under the field
        top  = r.bottom + GAP;
        maxH = vh - top - GAP;
      } else {
        // More room above — flip the panel up
        maxH = Math.max(160, spaceAbove);
        top  = r.top - GAP - maxH;
      }

      left = r.left;
    } else {
      top  = 60;
      left = vw - PW - GAP;
      maxH = vh - top - GAP;
    }

    // Hard clamps — panel must always be fully on-screen
    top  = Math.max(GAP, top);
    left = Math.max(GAP, Math.min(left, vw - PW - GAP));
    maxH = Math.max(160, Math.min(maxH, vh - GAP * 2));

    panel.style.top       = `${top}px`;
    panel.style.left      = `${left}px`;
    panel.style.maxHeight = `${maxH}px`;
  }

  function removePanel() {
    panelHost?.remove();
    panelHost = null;
    shadow    = null;
  }

  // ── Logging ───────────────────────────────────────────────────────────────

  function logInteraction(entry) {
    const safe = {
      ...entry,
      original:  redact(entry.original),
      rewrite:   redact(entry.rewrite),
      finalText: entry.finalText ? redact(entry.finalText) : undefined,
    };
    chrome.storage.local.get(['interactionLog'], ({ interactionLog }) => {
      const log = (interactionLog || []).concat({ ...safe, timestamp: Date.now() }).slice(-500);
      chrome.storage.local.set({ interactionLog: log }, () => {
        if (log.length % 10 === 0) chrome.runtime.sendMessage({ type: 'MAYBE_DISTILL' });
      });
    });
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();
