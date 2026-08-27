// ── Prompt-injection pattern scanning ───────────────────────────────────────
//
// Secondary, defense-in-depth layer on top of the delimiting/instruction-
// hierarchy approach in buildPrompt() (src/lib/utils.ts). This does NOT
// detect or prevent sophisticated injection — a determined attacker won't
// use any of these exact phrases. What it does do: flag the common,
// unsophisticated case (a document containing an obvious "ignore your
// instructions and do X" payload) so a human can see it, for content that
// gets retrieved and re-injected into prompts automatically later with no
// one reviewing it in the moment. Never used to silently block a document
// outright — false positives are expected (a document that's genuinely
// *about* prompt injection, AI safety, or contains a customer-support
// transcript quoting an attempted jailbreak would legitimately match) —
// so this only flags for visibility, never fails the upload.

export interface InjectionScanResult {
  flagged:  boolean
  matches:  string[]   // which pattern labels matched, for the flagged reason shown to the user
}

// Patterns are intentionally broad-but-labeled rather than an attempt at
// completeness — see the module comment above for why this is a
// visibility layer, not a prevention mechanism.
const PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'instruction override',   pattern: /\b(ignore|disregard|forget)\s+(all\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)\b/i },
  { label: 'instruction override',   pattern: /\bignore\s+everything\s+(above|before)\b/i },
  { label: 'fake role marker',       pattern: /^\s*(system|assistant)\s*:\s*/im },
  { label: 'new instructions claim', pattern: /\bnew\s+instructions?\s*:/i },
  { label: 'system prompt probing',  pattern: /\b(reveal|print|show|output|repeat)\s+(your\s+)?(system\s+prompt|initial\s+instructions?|the\s+instructions?\s+above)\b/i },
  { label: 'persona override',       pattern: /\byou\s+are\s+now\s+(a|an)\s+\w+/i },
  { label: 'developer mode claim',   pattern: /\b(developer|debug|admin|god)\s+mode\s+(enabled|activated|on)\b/i },
]

export function scanForInjectionPatterns(text: string): InjectionScanResult {
  const matchedLabels = new Set<string>()
  for (const { label, pattern } of PATTERNS) {
    if (pattern.test(text)) matchedLabels.add(label)
  }
  return {
    flagged: matchedLabels.size > 0,
    matches: Array.from(matchedLabels),
  }
}
