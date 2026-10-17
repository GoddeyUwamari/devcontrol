#!/usr/bin/env node
/**
 * Writes the demo workspace (dev/local/icp-data.js) into the local database:
 * the organization "Example SaaS Inc." (example-saas) and its login.
 *
 *   npm run dev:local -- --seed      set up the stack, seed, start the servers
 *
 * run.js starts this with the backend's own environment. It refuses unless
 * every check in dev/local/seed-guard.js passes, and only then, in one
 * transaction, deletes the previous example-saas organization (the schema
 * cascades every organization-scoped row, including whatever the app wrote
 * while the demo was used) and the seed's own users, and writes the
 * workspace again. Same seed and day, same rows.
 *
 * The demo login's password is generated once into
 * dev/local/.state/db/demo-login.txt and reused on every reseed of that
 * volume; it is never printed.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS script run by plain node */
const crypto = require('crypto');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { Client } = require('pg');
const { statePath, dbStatePath, writeStateFile } = require('./state');
const volume = require('./volume-credentials');
const guard = require('./seed-guard');
const { generateIcpData, DEMO_EMAIL, ORGANIZATION } = require('./icp-data');

const DEMO_LOGIN_FILE = 'db/demo-login.txt';
// Same as auth.service.ts.
const BCRYPT_ROUNDS = 10;

/** KEY=VALUE lines of a generated env file; never dotenv, never a real .env. */
function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

function readLoginFile(file) {
  if (!fs.existsSync(file)) return null;
  const fields = Object.fromEntries(
    fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    }),
  );
  return fields.email && fields.password ? fields : null;
}

/** Inserts rows (objects with the same keys) in chunks; plain objects become JSON. */
async function insertRows(client, table, rows) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  for (let start = 0; start < rows.length; start += 100) {
    const chunk = rows.slice(start, start + 100);
    const params = [];
    const tuples = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        const value = row[column];
        const isJson = value !== null && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value);
        params.push(isJson ? JSON.stringify(value) : value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, params);
  }
}

async function resetIcp(client, data) {
  await client.query('DELETE FROM organizations WHERE slug = $1', [ORGANIZATION.slug]);
  await client.query('DELETE FROM users WHERE email = ANY($1::text[])', [data.users.map((u) => u.email)]);
}

async function writeIcp(client, data, { demoPasswordHash, memberPasswordHash }) {
  const o = data.organization;
  await insertRows(client, 'organizations', [{
    id: o.id,
    name: o.name,
    slug: o.slug,
    display_name: o.display_name,
    description: o.description,
    subscription_tier: o.subscription_tier,
    max_services: o.max_services,
    max_users: o.max_users,
    max_deployments_per_month: o.max_deployments_per_month,
    created_at: o.created_at,
  }]);
  await insertRows(client, 'users', data.users.map((u) => ({
    id: u.id,
    email: u.email,
    password_hash: u.email === DEMO_EMAIL ? demoPasswordHash : memberPasswordHash,
    full_name: u.full_name,
    is_active: true,
    is_email_verified: true,
    created_at: u.created_at,
  })));
  await insertRows(client, 'organization_memberships', data.memberships.map((m) => ({
    id: m.id,
    organization_id: m.organization_id,
    user_id: m.user_id,
    role: m.role,
    invited_by: m.invited_by,
    invited_at: m.joined_at,
    joined_at: m.joined_at,
    created_at: m.joined_at,
  })));
  await insertRows(client, 'teams', data.teams.map((t) => ({
    id: t.id,
    organization_id: t.organization_id,
    name: t.name,
    description: t.description,
    members: t.members,
    slack_channel: t.slack_channel,
    owner: t.owner,
    created_at: t.created_at,
  })));
  await insertRows(client, 'services', data.services.map((s) => ({
    id: s.id,
    organization_id: s.organization_id,
    name: s.name,
    template: s.template,
    owner: s.owner,
    team_id: s.team_id,
    status: s.status,
    description: s.description,
    created_at: s.created_at,
  })));
  await insertRows(client, 'aws_resources', data.resources.map((r) => ({
    id: r.id,
    organization_id: r.organization_id,
    resource_arn: r.resource_arn,
    resource_id: r.resource_id,
    resource_name: r.resource_name,
    resource_type: r.resource_type,
    region: r.region,
    tags: r.tags,
    metadata: r.metadata,
    status: r.status,
    estimated_monthly_cost: r.estimated_monthly_cost,
    is_encrypted: r.is_encrypted,
    is_public: r.is_public,
    has_backup: r.has_backup,
    service_id: r.service_id,
    team_id: r.team_id,
    last_synced_at: r.last_synced_at,
    first_discovered_at: r.first_discovered_at,
    created_at: r.first_discovered_at,
  })));
  await insertRows(client, 'resource_discovery_jobs', data.discoveryJobs);
  await insertRows(client, 'cost_recommendations', data.recommendations);
  await insertRows(client, 'account_security_findings', data.findings.map((f) => ({ ...f, created_at: f.detected_at })));
}

/**
 * The whole run, with every outside dependency passed in so the refusals can
 * be tested without a database. Returns { refused } or { counts, passwordIssued }.
 */
async function runSeed({
  processEnv,
  backendEnv,
  connection,
  recordedMarker,
  makeClient,
  anchor,
  readDemoLogin,
  writeDemoLogin,
  hashPassword,
}) {
  const before = guard.preConnectRefusal({ processEnv, backendEnv, connection });
  if (before) return { refused: before };

  const client = makeClient(connection);
  await client.connect();
  try {
    const after = await guard.postConnectRefusal({
      client,
      recordedMarker,
      markerQuery: volume.MARKER_QUERY,
      parseMarkerComment: volume.parseMarkerComment,
    });
    if (after) return { refused: after };

    const data = generateIcpData({ anchor });
    const existing = readDemoLogin();
    const demoPassword = existing && existing.email === DEMO_EMAIL ? existing.password : `demo-${crypto.randomBytes(18).toString('base64url')}`;
    const demoPasswordHash = await hashPassword(demoPassword);
    // The other members cannot log in: their password is never kept.
    const memberPasswordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));

    await client.query('BEGIN');
    try {
      await resetIcp(client, data);
      await writeIcp(client, data, { demoPasswordHash, memberPasswordHash });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    const passwordIssued = !(existing && existing.password === demoPassword);
    if (passwordIssued) writeDemoLogin(DEMO_EMAIL, demoPassword);
    return {
      passwordIssued,
      counts: {
        users: data.users.length,
        teams: data.teams.length,
        services: data.services.length,
        aws_resources: data.resources.length,
        cost_recommendations: data.recommendations.length,
        account_security_findings: data.findings.length,
        resource_discovery_jobs: data.discoveryJobs.length,
      },
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const superuserPassword = fs.existsSync(dbStatePath('postgres.password'))
    ? fs.readFileSync(dbStatePath('postgres.password'), 'utf8').trim()
    : null;
  const connection = { ...guard.SEED_CONNECTION, user: 'postgres', password: superuserPassword };
  const result = await runSeed({
    processEnv: process.env,
    backendEnv: parseEnvFile(statePath('backend.env')),
    connection,
    recordedMarker: volume.readRecordedMarker(),
    makeClient: (config) => new Client(config),
    anchor: new Date(),
    readDemoLogin: () => readLoginFile(statePath(DEMO_LOGIN_FILE)),
    writeDemoLogin: (email, password) => writeStateFile(DEMO_LOGIN_FILE, `email=${email}\npassword=${password}\n`),
    hashPassword: (password) => bcrypt.hash(password, BCRYPT_ROUNDS),
  });
  if (result.refused) {
    console.error(`[dev:local seed] refusing: ${result.refused}`);
    process.exit(1);
  }
  console.log(`[dev:local seed] ${ORGANIZATION.name} (${ORGANIZATION.slug}) seeded: ${Object.entries(result.counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`[dev:local seed] log in as ${DEMO_EMAIL}; password in dev/local/.state/${DEMO_LOGIN_FILE} (${result.passwordIssued ? 'new' : 'unchanged'}, git-ignored)`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[dev:local seed] failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { runSeed, parseEnvFile, insertRows, DEMO_LOGIN_FILE };
