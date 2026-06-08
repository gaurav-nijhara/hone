# Hone

A Chrome/Edge Manifest V3 extension that improves your writing in place — in any text field on the web — and learns your voice over time so its suggestions converge on a professional version of *you*, not generic corporate polish.

## Install (developer mode)

1. Clone or download this repo.
2. Open Chrome → `chrome://extensions` → enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** → select the `hone/` folder.
4. Click the Hone toolbar icon → enter your Anthropic API key → Save.

## Usage

- Focus any text field and press **Alt+H**, or click the small **H** button that appears in the bottom-right corner of the field.
- The panel shows an improved version, a breakdown of what changed and why, and an honest verdict.
- **Accept** to replace the field text in place. **Reject** to leave it unchanged.
- Change the **register** (Professional / Concise / Diplomatic / Confident) in the panel header.
- Type a **steering note** ("too stiff", "keep my opening") and press Enter to iterate.

## What gets sent to the API

| Sent | Not sent |
|---|---|
| Field text (after privacy scan) | Your API key (header only, HTTPS) |
| Selected register | Raw interaction log |
| Injected style profile | Anything blocked by the pre-send scan |
| Medium/site context | |

Periodic distillation calls send redacted log summaries (style signals only, no raw content) to update your profile.

## Privacy

- **Field-level exclusions** — password, CC, OTP, API key, and secret fields never get the trigger button.
- **Origin-level blocks** — banking, password manager, and auth/checkout sites are skipped by default. Configurable in settings.
- **Pre-send scan** — Luhn-validated card numbers, SSN patterns, and long token strings are blocked before the API call.
- **Log redaction** — content entering the interaction log is redacted; style patterns only.
- Everything lives in `chrome.storage.local`. No server, no analytics, no telemetry.

## Files

```
hone/
  manifest.json
  src/
    background/service-worker.js   # API calls, distillation (ES modules)
    content/content-script.js      # field detection, panel, write-back
    lib/
      api.js       # Anthropic request builder
      prompts.js   # rewrite + distillation prompt templates
      storage.js   # chrome.storage.local wrappers
  options/
    options.html / .js / .css      # settings + profile viewer
```

## Honest limits

- Regex detection catches common sensitive patterns, not every exotic format. The field-level and origin-level blocks are the real backbone.
- Text in allowed fields does go to the Anthropic API to be rewritten — that is the core function.
- The style profile improves with use; it needs ~10 accepted rewrites before patterns emerge.
- Hotkey Alt+H chosen to avoid Chrome's built-in shortcuts. Ctrl+Shift+I (DevTools) cannot be overridden by extensions.

## TODO

- [ ] Add extension icons (16 / 48 / 128 px)
- [ ] Hotkey configuration in options page
- [ ] Import profile from JSON
- [ ] Mobile keyboard reuse (prompts.js / storage.js are dependency-free — portable as-is)
