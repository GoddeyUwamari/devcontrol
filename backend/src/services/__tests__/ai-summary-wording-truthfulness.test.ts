/**
 * Production-accuracy fix: AISummaryService.buildSummary() and
 * WeeklyAiSummaryJob.generateAIRecommendation() both described the generic
 * per-resource compliance-issue count as "(encryption, backups, tagging,
 * SOC2/HIPAA checks)". That's misleading: most of these findings carry no
 * framework label at all (encryption/backup/tagging/access-logging checks),
 * and even the HIPAA-labeled subset is tag-inferred, not a real HIPAA
 * evaluation -- naming SOC2/HIPAA here overstates what was actually checked.
 *
 * This is a static source-content regression test, following the same
 * pattern already established by app/(marketing)/__tests__/
 * soc2-readiness-messaging.test.ts and the other *-truthfulness.test.ts
 * files in this codebase -- both functions build their prompt/fact text
 * through several AI-service/repository dependencies that aren't worth
 * mocking end-to-end just to assert a wording fix; asserting on the actual
 * source text is the proportionate check here.
 *
 * Comments are stripped before checking for the prohibited phrase, exactly
 * like soc2-readiness-messaging.test.ts's readCode() helper -- this file's
 * own explanatory comments legitimately quote the old "SOC2/HIPAA checks"
 * text to document what was removed (the same pattern complianceScanner.ts's
 * checkSOC2Compliance doc comment already uses for its own retired "SOC2:"
 * prefix), and that must not trip the assertion.
 */
import fs from 'fs';
import path from 'path';

const AI_SUMMARY_SERVICE_PATH = path.join(__dirname, '..', 'ai-summary.service.ts');
const WEEKLY_AI_SUMMARY_JOB_PATH = path.join(__dirname, '..', '..', 'jobs', 'weekly-ai-summary.job.ts');

/** Strip block/line comments so explanatory comments never trip a prohibited-phrase assertion. */
function readCode(filePath: string): string {
  const full = fs.readFileSync(filePath, 'utf-8');
  return full.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('AI summary wording — SOC2/HIPAA mischaracterization removed', () => {
  it.each([
    ['ai-summary.service.ts', AI_SUMMARY_SERVICE_PATH],
    ['weekly-ai-summary.job.ts', WEEKLY_AI_SUMMARY_JOB_PATH],
  ])('%s no longer contains the misleading "SOC2/HIPAA checks" characterization in generated text', (_label, filePath) => {
    const code = readCode(filePath);
    expect(code).not.toMatch(/SOC2\/HIPAA/i);
    expect(code).not.toMatch(/SOC\s*2.*HIPAA\s+checks/i);
  });

  it.each([
    ['ai-summary.service.ts', AI_SUMMARY_SERVICE_PATH],
    ['weekly-ai-summary.job.ts', WEEKLY_AI_SUMMARY_JOB_PATH],
  ])('%s replaces it with wording that accurately names the real technical checks (encryption, backups, tagging)', (_label, filePath) => {
    const code = readCode(filePath);
    expect(code).toMatch(/encryption, backups, tagging, and other infrastructure checks/);
  });

  it('neither file has a remaining SOC2 or HIPAA token outside an explanatory comment', () => {
    for (const filePath of [AI_SUMMARY_SERVICE_PATH, WEEKLY_AI_SUMMARY_JOB_PATH]) {
      const code = readCode(filePath);
      expect(code).not.toMatch(/SOC\s*2/i);
      expect(code).not.toMatch(/\bHIPAA\b/);
    }
  });
});
