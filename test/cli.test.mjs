import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/aiwb.mjs', import.meta.url));
const env = { ...process.env, AIWB_HOME: mkdtempSync(join(tmpdir(), 'aiwb-cli-')) };

test('every file parses and the CLI prints help', () => {
  for (const dir of ['../bin', '../lib', '../lib/platforms']) {
    const d = fileURLToPath(new URL(dir + '/', import.meta.url));
    for (const f of readdirSync(d).filter(f => f.endsWith('.mjs'))) execFileSync(process.execPath, ['--check', join(d, f)]);
  }
  assert.match(execFileSync(process.execPath, [bin, 'help'], { env }).toString(), /aiwb buy/);
});

test('config: gas and slippage settings are checked', () => {
  const run = (...a) => execFileSync(process.execPath, [bin, 'config', 'set', ...a], { env, stdio: 'pipe' }).toString();
  run('gasLimit', '600000');
  run('speedUpAfterSec', '3');
  run('speedUpLevel', 'low');
  assert.throws(() => run('gasLimit', '5'));
  assert.throws(() => run('slippagePct', '150'));
  assert.throws(() => run('speedUpLevel', 'turbo'));
  const cfg = JSON.parse(execFileSync(process.execPath, [bin, 'config', '--json'], { env }).toString());
  assert.equal(cfg.gasLimit ?? cfg.config?.gasLimit, 600000);
});
