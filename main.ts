// Packages the entry: copies game/ and screenshots/ into the output dir and writes dossier.json.
// Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

mkdirSync(out, { recursive: true });
for (const name of ['game', 'screenshots']) {
  const dest = join(out, name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(root, name), dest, { recursive: true });
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648, game_path_max_bytes: 1000 }));
console.log('dossier written to', join(out, 'dossier.json'));
