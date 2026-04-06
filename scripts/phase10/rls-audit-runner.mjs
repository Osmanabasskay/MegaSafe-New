#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}

const roleTokens = [
  { role: 'anonymous', token: process.env.RLS_TOKEN_ANON || anonKey },
  { role: 'member', token: process.env.RLS_TOKEN_MEMBER },
  { role: 'collector', token: process.env.RLS_TOKEN_COLLECTOR },
  { role: 'group_creator', token: process.env.RLS_TOKEN_CREATOR },
  { role: 'super_admin', token: process.env.RLS_TOKEN_ADMIN },
].filter((entry) => Boolean(entry.token));

if (roleTokens.length < 2) {
  console.error('Provide at least two role tokens (RLS_TOKEN_* env vars) for meaningful audit coverage.');
  process.exit(1);
}

const checks = [
  { label: 'profiles', table: 'profiles', limit: 5 },
  { label: 'group_memberships', table: 'group_memberships', limit: 5 },
  { label: 'contributions', table: 'contributions', limit: 5 },
  { label: 'disputes', table: 'disputes', limit: 5 },
];

let failed = false;
for (const roleInfo of roleTokens) {
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${roleInfo.token}` } },
  });
  console.log(`\n[Role: ${roleInfo.role}]`);
  for (const check of checks) {
    const { data, error } = await client.from(check.table).select('*').limit(check.limit);
    if (error) {
      console.log(`- ${check.label}: blocked (${error.message})`);
      continue;
    }
    const count = Array.isArray(data) ? data.length : 0;
    console.log(`- ${check.label}: returned ${count} row(s)`);
    if (roleInfo.role !== 'super_admin' && check.table === 'profiles' && count > check.limit) {
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nRLS audit runner detected potential overexposure. Investigate policies.');
  process.exit(1);
}

console.log('\nRLS audit runner completed. Review output for unexpected row visibility.');
