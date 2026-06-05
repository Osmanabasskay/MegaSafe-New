#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const includeDirs = ['app', 'lib', 'stores', 'types', 'supabase', 'scripts/phase10'];
const denyPatterns = [
  { label: 'TODO marker', regex: /\bTODO\b/ },
  { label: 'FIXME marker', regex: /\bFIXME\b/ },
  { label: 'Legacy default name', regex: /Mi Osusu Member/i },
];

const requiredPaths = [
  'app/(settings)/terms.tsx',
  'app/(settings)/privacy.tsx',
  'app/(auth)/intro.tsx',
  'app/(auth)/register.tsx',
  'app/(auth)/otp.tsx',
  'apps/admin/app/admin/page.tsx',
  'apps/admin/middleware.ts',
];

const walkFiles = (dir) => {
  const absolute = path.join(projectRoot, dir);
  if (!fs.existsSync(absolute)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path.relative(projectRoot, full)));
    if (entry.isFile()) files.push(full);
  }
  return files;
};

const candidateFiles = includeDirs
  .flatMap(walkFiles)
  .filter((full) => /\.(ts|tsx|js|mjs|sql|md)$/.test(full))
  .filter(
    (full) =>
      path.relative(projectRoot, full).replace(/\\/g, '/') !== 'scripts/phase10/static-security-audit.mjs'
  );
const findings = [];

for (const file of candidateFiles) {
  const content = fs.readFileSync(file, 'utf8');
  for (const pattern of denyPatterns) {
    if (pattern.regex.test(content)) {
      findings.push({
        file: path.relative(projectRoot, file),
        issue: pattern.label,
      });
    }
  }
}

const missingPaths = requiredPaths.filter((target) => !fs.existsSync(path.join(projectRoot, target)));

if (findings.length > 0 || missingPaths.length > 0) {
  console.error('Phase 10 static audit failed.');
  if (findings.length > 0) {
    console.error('\nFindings:');
    findings.forEach((finding) => {
      console.error(`- [${finding.issue}] ${finding.file}`);
    });
  }
  if (missingPaths.length > 0) {
    console.error('\nMissing required files:');
    missingPaths.forEach((target) => console.error(`- ${target}`));
  }
  process.exit(1);
}

console.log('Phase 10 static audit passed.');
