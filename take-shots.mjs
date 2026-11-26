// Retake the README screenshots: serves game/ with serve.ts, opens each scene from shots.json
// in headless Chromium at 1280x800 and writes JPEGs into screenshots/ (<= 256 KiB each).
// Usage: node take-shots.mjs [port]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pw from '/home/hatch/workspace/earning/token-launch-radar/.pw-tools/node_modules/playwright-core/index.mjs';

const chromium = pw.chromium || (pw.default && pw.default.chromium);
const CHROME = '/home/hatch/workspace/earning/token-launch-radar/.pw-tools/cft/chrome-headless-shell-linux64/chrome-headless-shell';
const MAX_BYTES = 262144;
const QUALITIES = [90, 84, 78, 72, 66, 60, 54, 48, 42, 36, 30];

const root = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(root, 'shots.json'), 'utf8'));
const port = parseInt(process.argv[2] || '8765', 10);
const base = 'http://localhost:' + port + '/';
const outDir = join(root, 'screenshots');
mkdirSync(outDir, { recursive: true });

const server = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', join(root, 'serve.ts'), '--port', String(port)], {
  stdio: ['ignore', 'inherit', 'inherit']
});

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(base);
      if (r.ok) return;
    } catch (e) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start on ' + base);
}

const problems = [];
let browser = null;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: config.viewport, deviceScaleFactor: 1 });
  for (const scene of config.scenes) {
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(scene.name + ' console: ' + m.text());
    });
    page.on('pageerror', (e) => problems.push(scene.name + ' pageerror: ' + e.message));
    await page.goto(base + scene.query, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__skyhookRun && window.__skyhookRun().frame >= 8, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    let shot = null;
    let used = 0;
    for (const q of QUALITIES) {
      shot = await page.screenshot({ type: 'jpeg', quality: q });
      used = q;
      if (shot.length <= MAX_BYTES) break;
    }
    writeFileSync(join(outDir, scene.name), shot);
    const state = await page.evaluate(() => window.__skyhookRun());
    console.log(scene.name + ': ' + shot.length + ' bytes (q' + used + ') screen=' + state.screen + ' rings=' + state.rings);
    if (shot.length > MAX_BYTES) problems.push(scene.name + ' still over ' + MAX_BYTES + ' bytes');
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}

if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of problems) console.log(' - ' + p);
  process.exitCode = 1;
} else {
  console.log('no console or page errors');
}
