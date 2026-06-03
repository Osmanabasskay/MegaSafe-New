#!/usr/bin/env node
/**
 * Privilege Escalation Static Audit
 *
 * Fails if any source file reads role/is_admin/permissions from Supabase auth
 * metadata (raw_user_meta_data or user_metadata).  This is a regression gate:
 * the DB is the single source of truth for roles; metadata must never be trusted.
 *
 * USAGE:  node scripts/privilege-escalation-audit.mjs
 * EXIT:   0 = clean, 1 = violations found
 */

import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();

// Directories to scan (excludes node_modules and build artefacts automatically)
const SCAN_DIRS = ['app', 'lib', 'src', 'stores', 'types', 'supabase', 'scripts'];

// Directories treated as "app source" — test scripts are excluded from
// client-update pattern checks because they intentionally send protected
// fields to prove the DB blocks them.
const APP_SOURCE_DIRS = ['app', 'lib', 'src', 'stores'];

// File extensions to inspect
const EXT_RE = /\.(ts|tsx|js|mjs|sql)$/;

// --------------------------------------------------------------------------
// Patterns that indicate the codebase is trusting auth metadata for privilege
// decisions.  Each entry has a human-readable label and a regex.
// --------------------------------------------------------------------------
const DENY_PATTERNS = [
  // raw_user_meta_data.* privilege fields (SQL / server-side)
  {
    label: 'raw_user_meta_data.role — DB trigger must never use this for role assignment',
    regex: /raw_user_meta_data\s*->+\s*['"]?role['"]?/,
  },
  {
    label: 'raw_user_meta_data.is_admin — metadata is not authoritative',
    regex: /raw_user_meta_data\s*->+\s*['"]?is_admin['"]?/,
  },
  {
    label: 'raw_user_meta_data.permissions — metadata is not authoritative',
    regex: /raw_user_meta_data\s*->+\s*['"]?permissions['"]?/,
  },
  {
    label: 'raw_user_meta_data.collector — metadata is not authoritative',
    regex: /raw_user_meta_data\s*->+\s*['"]?collector['"]?/,
  },
  {
    label: 'raw_user_meta_data.org_admin — metadata is not authoritative',
    regex: /raw_user_meta_data\s*->+\s*['"]?org_admin['"]?/,
  },
  {
    label: 'raw_user_meta_data.super_admin — metadata is not authoritative',
    regex: /raw_user_meta_data\s*->+\s*['"]?super_admin['"]?/,
  },

  // user_metadata.* privilege fields (JS/TS client-side)
  {
    label: 'user_metadata.role — never trust client-side metadata for authorization',
    regex: /user_metadata\s*[\[.]?\s*['"]?role['"]?\s*[\].]?/,
  },
  {
    label: 'user_metadata.is_admin — never trust client-side metadata for authorization',
    regex: /user_metadata\s*[\[.]?\s*['"]?is_admin['"]?\s*[\].]?/,
  },
  {
    label: 'user_metadata.permissions — never trust client-side metadata for authorization',
    regex: /user_metadata\s*[\[.]?\s*['"]?permissions['"]?\s*[\].]?/,
  },
  {
    label: 'user_metadata.collector — never trust client-side metadata for authorization',
    regex: /user_metadata\s*[\[.]?\s*['"]?collector['"]?\s*[\].]?/,
  },
  {
    label: 'user_metadata.org_admin — never trust client-side metadata for authorization',
    regex: /user_metadata\s*[\[.]?\s*['"]?org_admin['"]?\s*[\].]?/,
  },
  {
    label: 'user_metadata.super_admin — never trust client-side metadata for authorization',
    regex: /user_metadata\s*[\[.]?\s*['"]?super_admin['"]?\s*[\].]?/,
  },

  // Dangerous patterns: role/privilege fields passed into signUp metadata
  {
    label: 'role field passed into signUp options.data — NEVER send role in signup metadata',
    regex: /signUp\s*\([^)]*role\s*:/s,
  },
  {
    label: 'is_admin field passed into signUp options.data',
    regex: /signUp\s*\([^)]*is_admin\s*:/s,
  },
  {
    label: 'permissions field passed into signUp options.data',
    regex: /signUp\s*\([^)]*permissions\s*:/s,
  },

  // Protected fields in client-side profile update calls.
  // NOTE: these patterns only apply to app source files, not test scripts —
  //       test scripts intentionally call .update({ role:... }) to prove it is blocked.
  //       Filtering to APP_ONLY_DIRS is handled in the scan loop below.
  {
    label: 'role field in client .update() call — protected fields must not be sent from the client',
    regex: /\.update\s*\(\s*\{[^}]*\brole\s*:/,
    appOnly: true,
  },
  {
    label: 'kyc_verified field in client .update() call',
    regex: /\.update\s*\(\s*\{[^}]*\bkyc_verified\s*:/,
    appOnly: true,
  },
  {
    label: 'kyc_status field in client .update() call',
    regex: /\.update\s*\(\s*\{[^}]*\bkyc_status\s*:/,
    appOnly: true,
  },
  {
    label: 'is_active field in client .update() call',
    regex: /\.update\s*\(\s*\{[^}]*\bis_active\s*:/,
    appOnly: true,
  },
  {
    label: '"status" field in client profiles .update() call',
    // Narrow to profiles table to avoid false positives on other tables
    regex: /from\s*\(\s*['"]profiles['"]\s*\)[^;]*\.update\s*\(\s*\{[^}]*\bstatus\s*:/s,
    appOnly: true,
  },
];

// --------------------------------------------------------------------------
// Self-exclusion: this file must be allowed to contain the pattern strings.
// --------------------------------------------------------------------------
const SELF = path.relative(projectRoot, new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));

function walkFiles(dir) {
  const absolute = path.join(projectRoot, dir);
  if (!fs.existsSync(absolute)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (['node_modules', '.git', '.next', 'dist', 'build'].includes(entry.name)) continue;
    const full = path.join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path.relative(projectRoot, full)));
    if (entry.isFile() && EXT_RE.test(entry.name)) files.push(full);
  }
  return files;
}

const allFiles = SCAN_DIRS.flatMap(walkFiles).filter((f) => {
  const rel = path.relative(projectRoot, f).replace(/\\/g, '/');
  return rel !== SELF && rel !== SELF.replace(/\\/g, '/');
});

const violations = [];

// Build a set of files that are within APP_SOURCE_DIRS for appOnly checks
const appSourceFiles = new Set(
  APP_SOURCE_DIRS.flatMap(walkFiles).map((f) => path.resolve(f)),
);

for (const file of allFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const rel = path.relative(projectRoot, file).replace(/\\/g, '/');
  const isAppSource = appSourceFiles.has(path.resolve(file));

  for (const { label, regex, appOnly } of DENY_PATTERNS) {
    // Skip patterns that are scoped to app source when the current file is a script
    if (appOnly && !isAppSource) continue;

    if (regex.test(content)) {
      // Find the line number(s) for context
      const lines = content.split('\n');
      const hits = lines
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => regex.test(line))
        .map(({ i }) => i + 1);

      violations.push({ file: rel, label, lines: hits });
    }
  }
}

// --------------------------------------------------------------------------
// Report
// --------------------------------------------------------------------------
console.log('\n=== Privilege Escalation Static Audit ===\n');

if (violations.length === 0) {
  console.log('✓ PASS — no metadata trust violations found.');
  console.log('\nVerified that no source file reads any of the following from auth metadata:');
  console.log('  • role / is_admin / permissions / collector / org_admin / super_admin');
  console.log('  • via raw_user_meta_data (SQL) or user_metadata (JS/TS)');
  console.log('\nVerified that no signUp call injects role/is_admin/permissions into metadata.');
  console.log('Verified that no client .update() call sends protected profile fields.');
  process.exit(0);
} else {
  console.error(`✗ FAIL — ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    const lineStr = v.lines.length ? ` (line${v.lines.length > 1 ? 's' : ''} ${v.lines.join(', ')})` : '';
    console.error(`  [VIOLATION] ${v.file}${lineStr}`);
    console.error(`              ${v.label}\n`);
  }
  console.error('Fix: remove all privilege-related reads from auth metadata.');
  console.error('     Role authority lives in the DB (profiles.role / user_roles), not in JWT metadata.');
  process.exit(1);
}
