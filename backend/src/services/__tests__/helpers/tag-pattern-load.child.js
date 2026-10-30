/**
 * Child process for custom-compliance.tag-pattern-load.test.ts. Runs tag_pattern
 * scans through the real CustomComplianceService.runScanBody (repository and
 * client mocked; each finding insert yields to the event loop as a real query
 * would) and reports timings to the parent over IPC. The parent kills this
 * process if it misses its deadline, so a regression can never hang jest.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { monitorEventLoopDelay, performance } = require('perf_hooks');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

const { CustomComplianceService } = require(path.join(__dirname, '../../custom-compliance.service.ts'));

const HEARTBEAT_MS = 10;

const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve));

function tagRule(id, pattern) {
  return {
    id, framework_id: 'framework-1', rule_code: id, rule_type: 'tag_pattern', conditions: { tag_key: 'Owner', pattern },
    severity: 'low', category: 'tagging', enabled: true, resource_types: [], recommendation: 'fix it',
  };
}

function resources(prefix, values) {
  return values.map((value, i) => ({
    id: `${prefix}-${i}`, resource_arn: `arn:aws:s3:::${prefix}-${i}`, resource_type: 's3', resource_name: `${prefix}-${i}`,
    tags: { Owner: value }, metadata: { tags_state: 'observed' },
  }));
}

/** One scan's body; resolves with its summary, its findings and each evaluation's duration. */
async function scan(rules, scanResources) {
  const svc = new CustomComplianceService({});
  const findings = [];
  const evalMs = [];
  let summary;
  svc.repository = {
    updateScan: async (_id, update) => {
      if (update.status === 'completed') summary = update;
      return { id: 'scan-1', ...update };
    },
    findFrameworkWithRules: async () => ({ rules }),
    findScanById: async () => ({ id: 'scan-1' }),
    createFinding: async (finding) => {
      findings.push(finding);
      await yieldToLoop();
    },
  };
  svc.fetchResources = async () => scanResources;
  const evaluate = svc.evaluateTagPattern.bind(svc);
  svc.evaluateTagPattern = (rule, resource) => {
    const start = performance.now();
    try {
      return evaluate(rule, resource);
    } finally {
      evalMs.push(performance.now() - start);
    }
  };
  await svc.runScanBody({ query: async () => ({ rows: [] }) }, { id: 'scan-1' }, 'framework-1', 'org-1', undefined);
  return { summary, findings, evalMs };
}

/** Starts a 10 ms heartbeat and an event-loop delay histogram; stop() reports them. */
function watchLoop() {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  let last = performance.now();
  let maxGapMs = 0;
  let beats = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGapMs = Math.max(maxGapMs, now - last);
    last = now;
    beats++;
  }, HEARTBEAT_MS);
  return () => {
    clearInterval(timer);
    histogram.disable();
    return { maxGapMs, beats, p99LagMs: histogram.percentile(99) / 1e6, maxLagMs: histogram.max / 1e6 };
  };
}

async function runEvaluations({ patterns, values }) {
  const stop = watchLoop();
  const start = performance.now();
  const perPattern = {};
  let evaluations = 0;
  let slowEvaluations = 0;
  for (const pattern of patterns) {
    const { evalMs, findings } = await scan([tagRule('rule', pattern)], resources('r', values));
    perPattern[pattern] = { worstMs: Math.max(...evalMs), statuses: [...new Set(findings.map((f) => f.status))] };
    evaluations += evalMs.length;
    slowEvaluations += evalMs.filter((ms) => ms > HEARTBEAT_MS).length;
  }
  return { perPattern, evaluations, slowEvaluations, totalMs: performance.now() - start, loop: stop() };
}

async function runConcurrent({ heavyPatterns, heavyValue, heavyCount, lightCount }) {
  const server = http.createServer((_req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/health`;
  const stop = watchLoop();

  const heavy = scan(heavyPatterns.map((p, i) => tagRule(`heavy-${i}`, p)), resources('a', Array(heavyCount).fill(heavyValue)));
  const light = scan([tagRule('light', '^team-')], resources('b', Array.from({ length: lightCount }, (_, i) => (i % 2 ? 'team-x' : 'other'))));

  const latencies = [];
  let done = false;
  const requests = (async () => {
    while (!done) {
      const start = performance.now();
      const res = await fetch(url);
      await res.text();
      latencies.push(performance.now() - start);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  })();

  const [heavyResult, lightResult] = await Promise.all([heavy, light]);
  done = true;
  await requests;
  const loop = stop();
  await new Promise((resolve) => server.close(resolve));
  return {
    loop,
    requests: latencies.length,
    maxRequestMs: Math.max(...latencies),
    heavy: { summary: heavyResult.summary, statuses: [...new Set(heavyResult.findings.map((f) => f.status))], worstMs: Math.max(...heavyResult.evalMs) },
    light: { summary: lightResult.summary, statuses: lightResult.findings.map((f) => f.status) },
  };
}

process.on('message', async (job) => {
  try {
    const result = job.kind === 'concurrent' ? await runConcurrent(job) : await runEvaluations(job);
    process.send({ ok: true, result }, () => process.exit(0));
  } catch (error) {
    process.send({ ok: false, error: String(error && error.stack ? error.stack : error) }, () => process.exit(1));
  }
});
process.send({ ready: true });
