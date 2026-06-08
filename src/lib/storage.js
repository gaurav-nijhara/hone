// chrome.storage.local wrappers

const DEFAULT_SETTINGS = {
  defaultRegister: 'professional',
  model: 'claude-sonnet-4-6',
  allowList: [],
  denyList: [],
};

function get(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => resolve(result[key]));
  });
}

function set(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

export async function getApiKey() { return get('apiKey'); }
export async function setApiKey(key) { return set('apiKey', key); }

export async function getSettings() {
  const s = await get('settings');
  return { ...DEFAULT_SETTINGS, ...s };
}
export async function setSettings(s) { return set('settings', s); }

export async function getLog() { return (await get('interactionLog')) || []; }
export async function appendLog(entry) {
  const log = await getLog();
  log.push({ ...entry, timestamp: Date.now() });
  return set('interactionLog', log.slice(-500));
}
export async function clearLog() { return set('interactionLog', []); }

export async function getProfile() { return (await get('styleProfile')) || null; }
export async function setProfile(p) { return set('styleProfile', p); }
export async function clearProfile() { return set('styleProfile', null); }
