const API_URL = 'https://api.anthropic.com/v1/messages';

export async function callClaude(apiKey, model, prompt, maxTokens = 1024) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (e) {
    throw new Error('Network error — check your connection.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Invalid API key. Open Hone settings to fix it.');
    if (response.status === 429) throw new Error('Rate limit reached. Wait a moment and try again.');
    throw new Error(body.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text ?? '';
  return parseJson(raw);
}

function parseJson(raw) {
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('Model returned malformed JSON — try again.');
  }
}
