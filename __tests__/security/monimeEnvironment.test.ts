/**
 * Monime environment + secret-exposure tests (static)
 *
 *   1. MONIME_BASE_URL is respected by the shared Monime client (env-driven,
 *      sandbox switch supported, live default).
 *   2. No Monime secret (access token, space id, webhook secrets) is ever
 *      referenced by frontend code (src/ and app/).
 *   3. The frontend never calls api.monime.io directly — all Monime traffic
 *      goes through Supabase Edge Functions.
 *   4. Required webhook secret env names are documented in .env.example.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(__dirname, '../..');

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) collectSourceFiles(full, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe('MONIME_BASE_URL environment handling', () => {
  const monimeSource = readFileSync(
    resolve(ROOT, 'supabase/functions/_shared/monime.ts'),
    'utf8',
  );

  it('reads MONIME_BASE_URL from the environment', () => {
    expect(monimeSource).toMatch(/Deno\.env\.get\(['"]MONIME_BASE_URL['"]\)/);
  });

  it('supports a sandbox switch and defaults to the live URL', () => {
    expect(monimeSource).toMatch(/MONIME_SANDBOX_BASE_URL/);
    expect(monimeSource).toMatch(/https:\/\/api\.monime\.io/);
    expect(monimeSource).toMatch(/https:\/\/sandbox\.api\.monime\.io/);
  });

  it('fails safely when the access token secret is missing', () => {
    expect(monimeSource).toMatch(/MONIME_ACCESS_TOKEN is not configured/);
  });

  it('fails safely when the space id secret is missing', () => {
    expect(monimeSource).toMatch(/MONIME_SPACE_ID is not configured/);
  });
});

describe('no Monime secrets or direct Monime calls in frontend code', () => {
  const frontendFiles = [
    ...collectSourceFiles(resolve(ROOT, 'src')),
    ...collectSourceFiles(resolve(ROOT, 'app')),
  ];

  it('frontend never references Monime credentials', () => {
    const offenders: string[] = [];
    for (const file of frontendFiles) {
      const content = readFileSync(file, 'utf8');
      if (/MONIME_ACCESS_TOKEN|MONIME_SECRET_KEY|MONIME_SPACE_ID|MONIME_WEBHOOK_SECRET|MONIME_VAULT_WEBHOOK_SECRET|MONIME_PAYOUT_WEBHOOK_SECRET/.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('frontend never calls the Monime API directly', () => {
    const offenders: string[] = [];
    for (const file of frontendFiles) {
      const content = readFileSync(file, 'utf8');
      if (/api\.monime\.io/.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe('.env.example documents all Monime configuration', () => {
  const envExample = readFileSync(resolve(ROOT, '.env.example'), 'utf8');

  it.each([
    'MONIME_BASE_URL',
    'MONIME_ACCESS_TOKEN',
    'MONIME_SPACE_ID',
    'MONIME_WEBHOOK_SECRET',
    'MONIME_VAULT_WEBHOOK_SECRET',
    'MONIME_PAYOUT_WEBHOOK_SECRET',
  ])('documents %s', (key) => {
    expect(envExample).toContain(key);
  });

  it('documents the payout webhook URL', () => {
    expect(envExample).toMatch(/functions\/v1\/payout-webhook/);
  });
});
