import { callClaude } from '../lib/api.js';
import { buildRewritePrompt, buildDistillationPrompt } from '../lib/prompts.js';
import { getApiKey, getSettings, getProfile, setProfile, getLog } from '../lib/storage.js';

// Open options page when the toolbar icon is clicked
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'REWRITE') {
    handleRewrite(msg.payload).then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true; // keep message channel open for async response
  }
  if (msg.type === 'MAYBE_DISTILL') {
    runDistillation(); // fire-and-forget; errors are logged, not surfaced
    return false;
  }
});

async function handleRewrite({ text, register, medium, steeringNote }) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('No API key set. Open Hone settings (click the toolbar icon).');

  const { model } = await getSettings();
  const profile = await getProfile();
  const prompt = buildRewritePrompt(text, register, medium, profile, steeringNote);
  return callClaude(apiKey, model, prompt, 1024);
}

async function runDistillation() {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) return;

    const log = await getLog();
    if (log.length === 0) return;

    const { model } = await getSettings();
    const currentProfile = await getProfile();
    const recent = log.slice(-50);

    const prompt = buildDistillationPrompt(recent, currentProfile);
    const newProfile = await callClaude(apiKey, model, prompt, 2048);
    await setProfile(newProfile);
  } catch (e) {
    console.warn('[Hone] distillation failed:', e.message);
  }
}
