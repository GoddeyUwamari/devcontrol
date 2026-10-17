import path from 'path';
import dotenv from 'dotenv';
import { LOCAL_STACK_FLAG, refuseToStart } from './local-stack-guard';

/** Written by `npm run dev:local` (dev/local/run.js); git-ignored, never committed. */
export const LOCAL_STACK_ENV_FILE = path.resolve(__dirname, '..', '..', '..', 'dev', 'local', '.state', 'backend.env');

/**
 * The backend's only dotenv entry point. With DEVCONTROL_LOCAL_STACK unset it
 * is exactly the plain `dotenv.config()` the backend always made (`.env` in
 * the working directory). With it set, only the local stack's own file is
 * read -- never backend/.env -- and local-stack-preload.ts checks the result.
 *
 * The flag is honoured only from the real process environment: a `.env` that
 * sets it would switch server.ts to local behaviour after the preload's checks
 * were skipped, so that refuses to boot.
 */
export function loadEnv(): void {
  if (process.env[LOCAL_STACK_FLAG]) {
    dotenv.config({ path: LOCAL_STACK_ENV_FILE });
    return;
  }
  const flagWasSet = process.env[LOCAL_STACK_FLAG] !== undefined;
  dotenv.config();
  if (!flagWasSet && process.env[LOCAL_STACK_FLAG] !== undefined) {
    refuseToStart(`${LOCAL_STACK_FLAG} must not be set in a .env file; use npm run dev:local`);
  }
}
