/**
 * NOT USED: the weekly email has no model-written content (WE-D9). Kept,
 * outside the send path, pending a grounded redesign (PR #136 review B1).
 * Moved here unchanged in behaviour from weekly-summary-content.ts when the
 * email became the executive brief; the prompt's facts are now the brief's
 * own sentences.
 */
import { EVIDENCE_CLAIM_RULES } from '../ai-context-contract';
import type { WeeklyFacts } from './facts';
import type { WeeklyBrief } from './rules';

/**
 * Fact lines for a model-written recommendation, or null when there are no
 * open cost findings and no open security findings in the facts.
 */
export function buildRecommendationPrompt(f: WeeklyFacts, brief: WeeklyBrief): string | null {
  const hasOpenRecommendations = f.savings.state === 'available' && f.savings.open.count > 0;
  const hasFindings = f.security.state === 'available' && f.security.open > 0;
  if (!hasOpenRecommendations && !hasFindings) return null;

  const facts = [
    `Summary: ${[brief.summary.bold, brief.summary.plain].filter(Boolean).join(' ')}`,
    ...brief.tiles.map(t => `${t.label}: ${[t.value, ...t.lines].join('; ')}`),
    ...brief.attention.map(item => `${item.title}: ${item.body.join(' ')}`),
    `Cost: ${(brief.cost?.lines ?? []).map(l => l.text).join(' ')}`,
    `Delivery: ${brief.delivery.line}`,
  ];

  return (
    `You are writing a single, specific, actionable recommendation for a weekly ` +
    `cloud infrastructure email, aimed at an engineering lead.\n\n` +
    `Use ONLY the facts below. Do not invent, estimate, or assume anything not explicitly ` +
    `stated. Do not add generic advice like "review your dashboard".\n\n` +
    `Evidence rules:\n${EVIDENCE_CLAIM_RULES.split('\n').map(rule => `- ${rule}`).join('\n')}\n` +
    `- Never say there was no spend, no alerts, or no security risks. Never state a trend, ` +
    `historical value, percentage, or dollar amount that is not in the facts.\n` +
    `- Savings are estimates: never say "you can save" or "you will save".\n` +
    `- Do not recommend rightsizing, Reserved Instances, or Savings Plans, and do not mention DORA or lead time.\n\n` +
    `Facts:\n${facts.map(fact => `- ${fact}`).join('\n')}\n\n` +
    `Write the recommendation now (1-2 sentences, no preamble, no markdown):`
  );
}

/** Claims the model may never make in the weekly email, whatever the evidence. */
const FORBIDDEN_RECOMMENDATION_CLAIMS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bno (cloud |aws )?(spend|spending|costs?)\b/i, reason: 'claims no spend' },
  { pattern: /\b(no|zero) (active |critical )?alerts?\b/i, reason: 'claims no alerts' },
  { pattern: /\bno (security )?(risks?|vulnerabilit(y|ies))\b/i, reason: 'claims no security risk' },
  { pattern: /\blead[- ]time\b|\bDORA\b/i, reason: 'mentions DORA lead time' },
  { pattern: /\bright-?siz/i, reason: 'claims rightsizing' },
  { pattern: /\breserved instances?\b|\bsavings plans?\b|\bRIs?\b/i, reason: 'claims RI/Savings Plan savings' },
  { pattern: /\b(you|we|they) (can|could|will|would) save\b|\bsave \$/i, reason: 'states savings as definite' },
];

/** Every dollar amount and percentage in `text`, normalized (no thousands separators, no trailing .00). */
function figuresIn(text: string): string[] {
  return (text.match(/\$\s?[\d,]+(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?%/g) ?? [])
    .map(f => f.replace(/[,\s]/g, '').replace(/\.0+(?=%|$)/, ''));
}

/**
 * The model's recommendation, or null when it makes a forbidden claim or
 * states a dollar amount / percentage that is not in the prompt's facts. It
 * checks only $ and % figures, so it is not enough on its own to re-enable
 * model text.
 */
export function checkRecommendationText(text: string | null, prompt: string): { text: string | null; rejected: string | null } {
  if (!text) return { text: null, rejected: null };
  const forbidden = FORBIDDEN_RECOMMENDATION_CLAIMS.find(rule => rule.pattern.test(text));
  if (forbidden) return { text: null, rejected: forbidden.reason };
  const allowed = new Set(figuresIn(prompt));
  const unsupported = figuresIn(text).find(figure => !allowed.has(figure));
  if (unsupported) return { text: null, rejected: `figure not in evidence: ${unsupported}` };
  return { text, rejected: null };
}
