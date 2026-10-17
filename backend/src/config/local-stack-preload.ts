/**
 * server.ts's first import, so it runs before any other module reads the
 * environment. With DEVCONTROL_LOCAL_STACK unset it does nothing at all; the
 * existing loadEnv() calls in config/database.ts and server.ts load `.env`
 * at the same points as before.
 */
import fs from 'fs';
import { loadEnv, LOCAL_STACK_ENV_FILE } from './load-env';
import { LOCAL_STACK_FLAG, applyAwsBlackHole, localStackRefusal, refuseToStart } from './local-stack-guard';

export function prepareLocalStack(): void {
  if (!process.env[LOCAL_STACK_FLAG]) return;
  if (!fs.existsSync(LOCAL_STACK_ENV_FILE)) refuseToStart('dev/local/.state/backend.env is missing (run npm run dev:local)');
  loadEnv();
  const reason = localStackRefusal(process.env);
  if (reason) refuseToStart(reason);
  applyAwsBlackHole(process.env);
  console.log('[local-stack] local mode: loopback database only, AWS and external integrations disabled');
}

prepareLocalStack();
