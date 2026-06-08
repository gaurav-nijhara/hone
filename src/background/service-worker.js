import { callClaude } from '../lib/api.js';
import { buildRewritePrompt, buildDistillationPrompt } from '../lib/prompts.js';
import { getApiKey, getSettings, getProfile, setProfile, getLog } from '../lib/storage.js';

// Open options page when the toolbar icon is clicked
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// ── Rewrite cache ─────────────────────────────────────────────────────────
// In-memory LRU cache keyed by (register, normalised text).
// Lives as long as the service worker is alive (typically the whole browser
// session). Cleared on profile distillation so stale suggestions can't
// creep in after the style profile updates.

const CACHE_MAX = 60;
const cache = new Map(); // key -> result object

function cacheKey(text, register) {
  // Normalise: trim + collapse internal whitespace so minor edits still hit
  const t = text.trim().replace(/\s+/g, ' ');
  return `${register}||${t}`;
}

function cacheGet(key) {
  if (!cache.has(key)) return null;
  // Move to end to mark as recently used
  const val = cache.get(key);
  cache.delete(key);
  cache.set(key, val);
  return val;
}

function cacheSet(key, result) {
  if (cache.size >= CACHE_MAX) {
    // Evict the oldest (first) entry
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, result);
}

// ── Message handler ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'REWRITE') {
    handleRewrite(msg.payload).then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true; // keep channel open for async response
  }
  if (msg.type === 'MAYBE_DISTILL') {
    runDistillation();
    return false;
  }
});

async function handleRewrite({ text, register, medium, steeringNote }) {
  // Steered rewrites are one-off — skip cache in both directions
  if (!steeringNote) {
    const key = cacheKey(text, register);
    const hit = cacheGet(key);
    if (hit) return { ...hit, fromCache: true };
  }

  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('No API key set. Open Hone settings (click the toolbar icon).');

  const { model } = await getSettings();
  const profile   = await getProfile();
  const prompt    = buildRewritePrompt(text, register, medium, profile, steeringNote);
  const result    = await callClaude(apiKey, model, prompt, 1024);

  if (!steeringNote) cacheSet(cacheKey(text, register), result);

  return result;
}

// ── Distillation ──────────────────────────────────────────────────────────

async function runDistillation() {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) return;

    const log = await getLog();
    if (log.length === 0) return;

    const { model }      = await getSettings();
    const currentProfile = await getProfile();
    const prompt         = buildDistillationPrompt(log.slice(-50), currentProfile);
    const newProfile     = await callClaude(apiKey, model, prompt, 2048);

    await setProfile(newProfile);

    // Profile changed → cached rewrites are potentially stale
    cache.clear();
    console.log('[Hone] profile distilled, cache cleared');
  } catch (e) {
    console.warn('[Hone] distillation failed:', e.message);
  }
}
