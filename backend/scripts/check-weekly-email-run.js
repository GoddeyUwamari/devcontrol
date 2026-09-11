#!/usr/bin/env node
/**
 * Read-only classification of a weekly-email cron run from a log excerpt you
 * already fetched. This script never contacts AWS, the database, Resend, or
 * production itself, and it never triggers the weekly-email job -- it only
 * parses text you hand it. See src/monitoring/weeklyEmailJobMonitor.ts (the
 * classifier this wraps) for the exact marker format and decision logic.
 *
 * Deliberately lives under backend/scripts/, not database/ -- same reason as
 * manage-platform-staff.js: the CI "Package migration artifact" step only
 * tars up database/, and migrate-deploy.test.ts asserts that artifact
 * contains just migrate.js + migrations/**. An unrelated ops script placed
 * there would silently ship inside that artifact.
 *
 * Requires a build (`npm run build`) to have produced dist/monitoring/
 * weeklyEmailJobMonitor.js -- on the production host this is always true
 * after any deploy, since the same dist/ already backs the running server.
 *
 * Fetching the log excerpt (read-only) -- e.g. via SSM against the
 * production instance -- is a separate, manual step. Example:
 *
 *   aws ssm send-command \
 *     --instance-ids <production-instance-id> \
 *     --document-name AWS-RunShellScript \
 *     --parameters 'commands=["grep \"\\[Weekly AI Summary\\]\" /home/ubuntu/.pm2/logs/devcontrol-api-out.log | tail -20"]'
 *
 *   aws ssm get-command-invocation --command-id <id> --instance-id <id> \
 *     --query StandardOutputContent --output text > /tmp/weekly-email-excerpt.log
 *
 * Then classify it:
 *
 *   node backend/scripts/check-weekly-email-run.js \
 *     --expected-release <release-sha> \
 *     --file /tmp/weekly-email-excerpt.log
 *
 *   # or pipe it directly:
 *   cat /tmp/weekly-email-excerpt.log | node backend/scripts/check-weekly-email-run.js --expected-release <release-sha>
 *
 * Usage:
 *   check-weekly-email-run.js --expected-release <sha> [--file <path>]
 *
 * Exit code 0 only for COMPLETED_SUCCESSFULLY; non-zero for every other
 * status, so this is safe to use as a CI/alerting gate as well as by hand.
 */

const fs = require('fs');

function parseArgs(argv) {
  const args = { file: null, expectedRelease: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') {
      args.file = argv[++i];
    } else if (argv[i] === '--expected-release') {
      args.expectedRelease = argv[++i];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      args.help = true;
    }
  }
  return args;
}

function printUsage() {
  console.error('Usage: check-weekly-email-run.js --expected-release <sha> [--file <path>]');
  console.error('Reads log text from --file, or from stdin if --file is omitted.');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (!args.expectedRelease) {
    printUsage();
    process.exit(2);
  }

  let logText;
  try {
    logText = args.file ? fs.readFileSync(args.file, 'utf8') : fs.readFileSync(0, 'utf8');
  } catch (err) {
    console.error(`Failed to read log input: ${err.message}`);
    process.exit(2);
  }

  let evaluateWeeklyEmailRun;
  try {
    ({ evaluateWeeklyEmailRun } = require('../dist/monitoring/weeklyEmailJobMonitor'));
  } catch (err) {
    console.error(
      'Could not load dist/monitoring/weeklyEmailJobMonitor.js -- run `npm run build` first.\n' +
      `(${err.message})`
    );
    process.exit(2);
  }

  const result = evaluateWeeklyEmailRun(logText, args.expectedRelease);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'COMPLETED_SUCCESSFULLY' ? 0 : 1);
}

main();
