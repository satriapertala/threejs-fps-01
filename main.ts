// SECTOR 9 — entrypoint for the threejs-fps-02 challenge.
//
// What this file does when run under Node 22 (no dependencies, stdlib only):
//   1. creates the submission directory (the grader's /output, or $MAKEFUN_OUTPUT_DIR elsewhere),
//   2. copies this repo's game/ folder and the screenshots/ folder into it, and
//   3. emits dossier.json — the machine-readable summary the scorer reads — using the vendored
//      make.fun helper library in vendor/.
//
// The game itself lives entirely in game/ as static ES modules the browser loads; three.js comes
// from an import map. To play it locally: `node serve.ts`, then browse to http://localhost:8080.
// Screenshots (PNG/JPEG) belong in screenshots/; the alphabetically first one is the cover.
//
// Caps mirror reference/gate.json from the scorer. text_max_bytes is a hard byte limit we must
// stay under; the rest are sanity checks so the entry fails here, loudly, rather than being
// rejected downstream (<= 4 screenshots, each <= 256 KiB; game/ holds <= 993 files and
// <= 48 MiB — alongside /output's global limit of 1000 entries counting game/, screenshots/
// and dossier.json together).

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const screenshotsSrc = join(repoRoot, 'screenshots');
const screenshotsDst = join(outputDir, 'screenshots');

// Lay down the tree. screenshots/ is always created so the dossier builder sees the
// directory even when the repo has no captures yet; its contents are copied only if present.
mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(screenshotsDst, { recursive: true });
if (existsSync(screenshotsSrc)) cpSync(screenshotsSrc, screenshotsDst, { recursive: true });

const limits = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
} as const;

writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, limits));
