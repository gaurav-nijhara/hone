const REGISTER_INSTRUCTIONS = {
  professional: 'Polished and workplace-ready. Clear, competent, warm but not casual.',
  concise:      'Same meaning, fewer words. Cut hedges, filler, and redundancy ruthlessly.',
  diplomatic:   'Warm and tactful. Prioritise the relationship; low friction.',
  confident:    'Direct and self-assured. Lead with the point; no excessive hedging.',
};

export function buildRewritePrompt(text, register, medium, profile, steeringNote) {
  const registerGuide = REGISTER_INSTRUCTIONS[register] ?? REGISTER_INSTRUCTIONS.professional;

  const profileSection = profile ? `
STYLE PROFILE (learned from your past interactions — honour this):
- Natural voice: ${profile.naturalVoice}
- Target register: ${profile.targetRegister}
- Recurring patterns to address: ${profile.delta}
` : '';

  const steerSection = steeringNote ? `
USER STEERING NOTE: "${steeringNote}"
Apply this direction on top of the register guidelines. It overrides defaults for this message only.
` : '';

  return `You are a writing assistant that improves messages while preserving the author's authentic voice.

MEDIUM: ${medium}
REGISTER: ${registerGuide}
${profileSection}${steerSection}
RULES:
1. Preserve every fact, name, date, and number exactly as given.
2. Match the medium — keep Slack messages short, honour email conventions, etc.
3. Raise the register without flattening the voice.${profile ? ' Follow the style profile.' : ''}
4. Be honest: if the original is already strong, say so and return it unchanged with an empty changes array.
5. Keep changes[] minimal when the original is already good.

Return ONLY valid JSON (no markdown fences, no explanation outside the JSON):
{
  "rewrite": "the improved version, or the original if no improvement needed",
  "changes": [
    { "change": "short label", "reason": "one short sentence on why this is better" }
  ],
  "verdict": "one honest sentence — was the original fine, or did it have real issues?"
}

ORIGINAL TEXT:
${text}`;
}

export function buildDistillationPrompt(logEntries, currentProfile) {
  const entries = logEntries.map((e, i) => `
[${i + 1}] outcome=${e.outcome} register=${e.register}
  original:  ${e.original}
  rewrite:   ${e.rewrite}
  finalText: ${e.finalText ?? '(same as rewrite)'}
  steering:  ${e.iterations?.map(it => it.instruction).join(', ') || 'none'}
  changes accepted: ${JSON.stringify(e.changes ?? [])}
`).join('');

  return `You are building a compact style profile for a writer based on their writing assistant history.

TASK: Update the style profile based on the interaction log. A pattern becomes a standing rule only after it recurs across multiple different messages — one-off, message-specific directives must NOT reshape the profile.

CURRENT PROFILE:
${currentProfile ? JSON.stringify(currentProfile, null, 2) : 'None yet — build from scratch.'}

RECENT INTERACTIONS (content redacted, style signals preserved):
${entries}

FIELDS:
- naturalVoice: their authentic vocabulary, rhythm, and signature phrasing that must survive into the professional version
- targetRegister: what "professional them" sounds like, inferred from rewrites they accepted
- delta: recurring tells (e.g. over-apologising, burying the ask, stacking hedges) and specific fixes they consistently endorse — ONLY patterns that appear in multiple messages

Return ONLY valid JSON (no markdown fences):
{
  "naturalVoice": "...",
  "targetRegister": "...",
  "delta": "..."
}`;
}
