/**
 * The deterministic topic selector (A-D16): question text -> topics, by
 * keyword. No model call, so the same question always loads the same
 * providers, and the choice can be tested and explained.
 *
 * For a conversation, the topics of the last 3 user turns are combined, so a
 * follow-up ("and last month?") keeps the earlier topic. No match means no
 * topics: the registry then loads its priority-1 providers.
 */
import { EVIDENCE_TOPICS, type EvidenceTopic } from './types';

const TOPIC_PATTERNS: Record<EvidenceTopic, RegExp> = {
  cost: /\b(cost|costs|spend|spent|spending|bill|billed|billing|charge[ds]?|invoice|budget|expensive|price[ds]?|pricing|money|month[- ]over[- ]month|last month|this month)\b|\$/i,
  savings: /\b(sav(e|es|ing|ings)|idle|unused|waste[ds]?|rightsiz\w*|right-siz\w*|optimi[sz]\w*|recommendations?|reduce|cheaper|orphan\w*|delete|downsiz\w*|stop)\b/i,
  security: /\b(secur\w*|risks?|risky|vulnerab\w*|exposed|exposure|open ports?|security groups?|iam|mfa|access keys?|findings?|threats?|posture|accepted risk|dismissed|hub)\b/i,
  compliance: /\b(complian\w*|soc ?2|cis|pci|nist|hipaa|frameworks?|audit\w*|controls?|encrypt\w*|backups?)\b/i,
  ops: /\b(alerts?|alarms?|alarming|incidents?|outages?|down|health|healthy|unhealthy|failing|errors?|error rate|latency|uptime|availability|operational|monitor\w*)\b/i,
  telemetry: /\b(cpu|utili[sz]ation|utili[sz]ed|memory|metrics?|cloudwatch|datapoints?|telemetry|usage|invocations?|load)\b/i,
  delivery: /\b(deploy\w*|releases?|dora|lead time|mttr|change failure|failure rate|frequency|pipelines?|ci\/cd)\b/i,
  inventory: /\b(resources?|instances?|ec2|rds|lambda|s3|buckets?|databases?|inventory|how many|services?|servers?|functions?)\b/i,
  regions: /\b(regions?|regional|us-[a-z]+-\d|eu-[a-z]+-\d|ap-[a-z]+-\d|multi-region|coverage|accounts?|where)\b/i,
};

export function topicsForText(text: string): EvidenceTopic[] {
  return EVIDENCE_TOPICS.filter((topic) => TOPIC_PATTERNS[topic].test(text));
}

/** Topics of the last `turns` user messages, in the fixed EVIDENCE_TOPICS order. */
export function topicsForConversation(messages: ReadonlyArray<{ role: string; content: string }>, turns = 3): EvidenceTopic[] {
  const recent = messages.filter((m) => m.role === 'user').slice(-turns);
  const found = new Set<EvidenceTopic>();
  for (const m of recent) for (const t of topicsForText(m.content)) found.add(t);
  return EVIDENCE_TOPICS.filter((t) => found.has(t));
}
