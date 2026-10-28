/**
 * Import first, before anything that builds a router: installs the walker's
 * mount-path recorder (see route-walker.ts).
 */
import { installMountPathRecorder } from './route-walker';

installMountPathRecorder();
