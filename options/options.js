import {
  getApiKey, setApiKey,
  getSettings, setSettings,
  getLog, clearLog,
  getProfile, setProfile, clearProfile,
} from '../src/lib/storage.js';

// ── Load saved values ─────────────────────────────────────────────────────

async function load() {
  const [apiKey, settings, profile, log] = await Promise.all([
    getApiKey(), getSettings(), getProfile(), getLog(),
  ]);

  if (apiKey) document.getElementById('api-key').value = apiKey;

  document.getElementById('default-register').value = settings.defaultRegister;
  document.getElementById('model').value = settings.model;
  document.getElementById('deny-list').value  = (settings.denyList  || []).join('\n');
  document.getElementById('allow-list').value = (settings.allowList || []).join('\n');

  renderProfile(profile);
  renderLog(log);
}

// ── Profile display ───────────────────────────────────────────────────────

function renderProfile(profile) {
  const view  = document.getElementById('profile-view');
  const badge = document.getElementById('profile-badge');

  if (!profile) {
    view.className = 'profile-empty';
    view.textContent = 'No profile yet — accept a few rewrites and it will appear here.';
    badge.textContent = '';
    return;
  }

  badge.textContent = 'Active';
  view.className = '';
  view.innerHTML = ['naturalVoice', 'targetRegister', 'delta'].map((key) => `
    <div class="profile-field">
      <div class="profile-field-label">${key}</div>
      <textarea id="pf-${key}" rows="3">${esc(profile[key] ?? '')}</textarea>
    </div>
  `).join('');
}

function readProfileEdits() {
  const keys = ['naturalVoice', 'targetRegister', 'delta'];
  const edits = {};
  let hasAny = false;
  for (const k of keys) {
    const el = document.getElementById(`pf-${k}`);
    if (el) { edits[k] = el.value.trim(); hasAny = true; }
  }
  return hasAny ? edits : null;
}

// ── Log display ───────────────────────────────────────────────────────────

function renderLog(log) {
  const view  = document.getElementById('log-view');
  const badge = document.getElementById('log-badge');

  badge.textContent = log.length ? `${log.length} entries` : '';

  if (!log.length) {
    view.className = 'log-empty';
    view.textContent = 'No interactions logged yet.';
    return;
  }

  view.className = '';
  const recent = log.slice(-20).reverse();
  view.innerHTML = recent.map((e) => {
    const date = new Date(e.timestamp).toLocaleString();
    return `
      <div class="log-entry">
        <div class="log-entry-meta">
          <span class="pill ${esc(e.outcome)}">${esc(e.outcome)}</span>
          <span class="pill">${esc(e.register)}</span>
          <span class="pill">${esc(e.medium)}</span>
          <span style="font-size:11px;color:#aaa;margin-left:auto">${esc(date)}</span>
        </div>
        <div class="log-text">
          <strong>Original:</strong> ${esc((e.original || '').slice(0, 120))}${(e.original || '').length > 120 ? '…' : ''}
        </div>
        ${e.iterations?.length ? `<div class="log-text" style="margin-top:3px"><strong>Steering:</strong> ${esc(e.iterations.map(i => i.instruction).join(' → '))}</div>` : ''}
      </div>
    `;
  }).join('');

  if (log.length > 20) {
    view.insertAdjacentHTML('beforeend', `<div style="font-size:12px;color:#aaa;text-align:center;padding:6px 0">Showing last 20 of ${log.length} entries</div>`);
  }
}

// ── Save ──────────────────────────────────────────────────────────────────

async function save() {
  const apiKey = document.getElementById('api-key').value.trim();
  const msg    = document.getElementById('save-msg');

  if (!apiKey) {
    flash(msg, 'API key is required', true); return;
  }

  const settings = {
    defaultRegister: document.getElementById('default-register').value,
    model:           document.getElementById('model').value,
    denyList:  lines(document.getElementById('deny-list').value),
    allowList: lines(document.getElementById('allow-list').value),
  };

  await Promise.all([setApiKey(apiKey), setSettings(settings)]);

  // Save profile edits if the user modified the text areas
  const profileEdits = readProfileEdits();
  if (profileEdits) await setProfile(profileEdits);

  flash(msg, 'Saved ✓');
}

// ── Wire events ───────────────────────────────────────────────────────────

document.getElementById('save').addEventListener('click', save);

document.getElementById('toggle-key').addEventListener('click', () => {
  const input = document.getElementById('api-key');
  input.type  = input.type === 'password' ? 'text' : 'password';
});

document.getElementById('export-profile').addEventListener('click', async () => {
  const profile = await getProfile();
  if (!profile) { alert('No profile to export yet.'); return; }
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'hone-profile.json';
  a.click(); URL.revokeObjectURL(url);
});

document.getElementById('wipe-profile').addEventListener('click', async () => {
  if (!confirm('Wipe your style profile? This cannot be undone.')) return;
  await clearProfile();
  renderProfile(null);
  flash(document.getElementById('save-msg'), 'Profile wiped');
});

document.getElementById('wipe-log').addEventListener('click', async () => {
  if (!confirm('Wipe the interaction log? This cannot be undone.')) return;
  await clearLog();
  renderLog([]);
  flash(document.getElementById('save-msg'), 'Log wiped');
});

// ── Helpers ───────────────────────────────────────────────────────────────

function lines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

function flash(el, text, isErr = false) {
  el.textContent = text;
  el.className   = `save-msg${isErr ? ' err' : ''}`;
  setTimeout(() => { el.textContent = ''; el.className = 'save-msg'; }, 3000);
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────

load();
