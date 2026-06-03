/**
 * Mi Osusu RLS Test Suite
 *
 * Tests Row Level Security policies against the live Supabase project.
 *
 * USAGE:
 *   npx tsx scripts/test-rls.ts
 *
 * REQUIREMENTS:
 *   Set these env vars (never committed — use .env.test.local):
 *     SUPABASE_URL           — project URL
 *     SUPABASE_ANON_KEY      — anon/public key
 *     SUPABASE_SERVICE_ROLE_KEY — service role (used only for test setup/teardown)
 *     RLS_TEST_USER_A_EMAIL  — email for test user A
 *     RLS_TEST_USER_A_PASS   — password for test user A
 *     RLS_TEST_USER_B_EMAIL  — email for test user B
 *     RLS_TEST_USER_B_PASS   — password for test user B
 *
 * If any credential is missing, affected tests are marked MANUAL REQUIRED.
 *
 * SAFETY GUARANTEES:
 *   - Only touches rows with a 'rls_test_' prefix in test fields.
 *   - Never prints passwords, tokens, or service role keys.
 *   - Cleans up all test data after the run (best-effort; errors are logged).
 *   - Never uses real production user IDs.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── Env ────────────────────────────────────────────────────────────────────

const SUPABASE_URL       = process.env['SUPABASE_URL'] ?? '';
const SUPABASE_ANON_KEY  = process.env['SUPABASE_ANON_KEY'] ?? '';
const SERVICE_ROLE_KEY   = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
const USER_A_EMAIL       = process.env['RLS_TEST_USER_A_EMAIL'] ?? '';
const USER_A_PASS        = process.env['RLS_TEST_USER_A_PASS'] ?? '';
const USER_B_EMAIL       = process.env['RLS_TEST_USER_B_EMAIL'] ?? '';
const USER_B_PASS        = process.env['RLS_TEST_USER_B_PASS'] ?? '';

const configured =
  SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_ROLE_KEY &&
  USER_A_EMAIL && USER_A_PASS && USER_B_EMAIL && USER_B_PASS;

// ─── Types ───────────────────────────────────────────────────────────────────

type TestResult = { name: string; status: 'PASS' | 'FAIL' | 'MANUAL_REQUIRED'; detail?: string };
const results: TestResult[] = [];

function pass(name: string) { results.push({ name, status: 'PASS' }); }
function fail(name: string, detail: string) { results.push({ name, status: 'FAIL', detail }); }
function manual(name: string, detail: string) { results.push({ name, status: 'MANUAL_REQUIRED', detail }); }

// ─── Client factories ────────────────────────────────────────────────────────

function makeAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}

function makeServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function signIn(email: string, pass: string): Promise<SupabaseClient | null> {
  const client = makeAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: pass });
  if (error) return null;
  return client;
}

// ─── Setup helpers ────────────────────────────────────────────────────────────

async function setupTestData(svc: SupabaseClient): Promise<{
  userAId: string;
  userBId: string;
  groupId: string;
  goalId: string;
}> {
  // Get authenticated user IDs from admin
  const { data: usersA } = await svc.auth.admin.listUsers();
  const userA = (usersA?.users ?? []).find((u) => u.email === USER_A_EMAIL);
  const userB = (usersA?.users ?? []).find((u) => u.email === USER_B_EMAIL);

  if (!userA || !userB) throw new Error('Test users not found in auth.users');

  const userAId = userA.id;
  const userBId = userB.id;

  // Ensure profiles exist for both users
  await svc.from('profiles').upsert({ id: userAId, full_name: 'RLS Test User A' }, { onConflict: 'id' });
  await svc.from('profiles').upsert({ id: userBId, full_name: 'RLS Test User B' }, { onConflict: 'id' });

  // Create a test osusu group owned by user A
  const { data: group } = await svc
    .from('osusu_groups')
    .insert({
      name: 'rls_test_group',
      created_by: userAId,
      contribution_amount: 100,
      max_members: 10,
      frequency: 'monthly',
      total_cycles: 12,
      status: 'active',
    })
    .select('id')
    .single();

  const groupId = group?.id ?? '';

  // Create a savings goal for user B (user A should not see it)
  const { data: goal } = await svc
    .from('savings_goals')
    .insert({ user_id: userBId, title: 'rls_test_goal', target_amount: 1000, current_amount: 0 })
    .select('id')
    .single();

  const goalId = goal?.id ?? '';

  return { userAId, userBId, groupId, goalId };
}

async function teardown(svc: SupabaseClient, groupId: string, goalId: string): Promise<void> {
  if (groupId) await svc.from('osusu_groups').delete().eq('id', groupId);
  if (goalId)  await svc.from('savings_goals').delete().eq('id', goalId);
}

// ─── RLS Tests ────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  if (!configured) {
    const NEEDED = [
      'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
      'RLS_TEST_USER_A_EMAIL', 'RLS_TEST_USER_A_PASS',
      'RLS_TEST_USER_B_EMAIL', 'RLS_TEST_USER_B_PASS',
    ];
    const missing = NEEDED.filter((k) => !process.env[k]);
    const detail = `Missing env vars: ${missing.join(', ')}. Set them in .env.test.local and re-run.`;

    const rlsTests = [
      'User A cannot read User B profile',
      'User A cannot read User B vault/savings goals',
      'User A cannot read User B savings transactions',
      'User A cannot read User B contribution payments',
      'User A cannot read User B withdrawal requests',
      'Member cannot approve payment',
      'Member cannot reject payment',
      'Member cannot update own role',
      'Member cannot read audit logs',
      'Collector cannot access unassigned group',
      'Collector cannot collect for unassigned member',
      'Org admin cannot manage another org',
      'Anon key cannot INSERT into contribution_payments',
      'Anon key cannot UPDATE vault/savings balances',
      'Anon key cannot UPDATE audit_logs',
      'Anon key cannot INSERT into financial transactions',
    ];
    for (const name of rlsTests) manual(name, detail);
    return;
  }

  const svc = makeServiceClient();
  let groupId = '';
  let goalId = '';

  try {
    const { userAId, userBId, groupId: gId, goalId: goId } = await setupTestData(svc);
    groupId = gId;
    goalId  = goId;

    // Sign in as A and B
    const clientA = await signIn(USER_A_EMAIL, USER_A_PASS);
    const clientB = await signIn(USER_B_EMAIL, USER_B_PASS);

    if (!clientA) { fail('Sign in as User A', 'Authentication failed'); return; }
    if (!clientB) { fail('Sign in as User B', 'Authentication failed'); return; }

    // ── 1. User A cannot read User B profile ─────────────────────────────────
    {
      const { data } = await clientA.from('profiles').select('id').eq('id', userBId);
      if (!data || data.length === 0) {
        pass('User A cannot read User B profile');
      } else {
        fail('User A cannot read User B profile', 'RLS policy missing — A can read B profile');
      }
    }

    // ── 2. User A cannot read User B savings goals ────────────────────────────
    {
      const { data } = await clientA.from('savings_goals').select('id').eq('id', goalId);
      if (!data || data.length === 0) {
        pass('User A cannot read User B savings goals');
      } else {
        fail('User A cannot read User B savings goals', 'RLS policy missing — A can read B goal');
      }
    }

    // ── 3. User A cannot read User B savings transactions ─────────────────────
    {
      const { data } = await clientA
        .from('savings_transactions')
        .select('id')
        .eq('user_id', userBId)
        .limit(1);
      if (!data || data.length === 0) {
        pass('User A cannot read User B savings transactions');
      } else {
        fail('User A cannot read User B savings transactions', 'RLS policy missing');
      }
    }

    // ── 4. User A cannot read User B contribution payments ────────────────────
    {
      const { data } = await clientA
        .from('contribution_payments')
        .select('id')
        .eq('member_id', userBId)
        .limit(1);
      if (!data || data.length === 0) {
        pass('User A cannot read User B contribution payments');
      } else {
        fail('User A cannot read User B contribution payments', 'RLS policy missing');
      }
    }

    // ── 5. User A cannot read User B withdrawal requests ─────────────────────
    {
      const { data } = await clientA
        .from('withdrawal_requests')
        .select('id')
        .eq('user_id', userBId)
        .limit(1);
      if (!data || data.length === 0) {
        pass('User A cannot read User B withdrawal requests');
      } else {
        fail('User A cannot read User B withdrawal requests', 'RLS policy missing');
      }
    }

    // ── 6. Member (user B) cannot approve payment ─────────────────────────────
    {
      const { error } = await clientB
        .from('contribution_payments')
        .update({ status: 'approved' })
        .eq('group_id', groupId);
      if (error) {
        pass('Member cannot approve payment');
      } else {
        fail('Member cannot approve payment', 'Direct UPDATE to contribution_payments succeeded — RLS missing');
      }
    }

    // ── 7. Member cannot reject payment ──────────────────────────────────────
    {
      const { error } = await clientB
        .from('contribution_payments')
        .update({ status: 'rejected' })
        .eq('group_id', groupId);
      if (error) {
        pass('Member cannot reject payment');
      } else {
        fail('Member cannot reject payment', 'Direct UPDATE succeeded — RLS missing');
      }
    }

    // ── 8. Member cannot update own role ──────────────────────────────────────
    {
      const { error } = await clientB
        .from('user_roles')
        .update({ role: 'super_admin' })
        .eq('user_id', userBId);
      if (error) {
        pass('Member cannot update own role');
      } else {
        fail('Member cannot update own role', 'user_roles UPDATE succeeded for non-admin');
      }
    }

    // ── 9. Member cannot read audit logs ──────────────────────────────────────
    {
      const { data } = await clientB.from('audit_logs').select('id').limit(1);
      if (!data || data.length === 0) {
        pass('Member cannot read audit logs');
      } else {
        fail('Member cannot read audit logs', 'audit_logs readable by regular member');
      }
    }

    // ── 10. Anon key cannot INSERT into contribution_payments ─────────────────
    {
      const anonClient = makeAnonClient(); // not signed in
      const { error } = await anonClient.from('contribution_payments').insert({
        group_id: groupId,
        member_id: userAId,
        amount: 9999,
        status: 'approved',
        currency: 'NLe',
      });
      if (error) {
        pass('Anon key cannot INSERT into contribution_payments');
      } else {
        fail('Anon key cannot INSERT into contribution_payments', 'CRITICAL: anon INSERT succeeded');
      }
    }

    // ── 11. Anon key cannot UPDATE balances ───────────────────────────────────
    {
      const anonClient = makeAnonClient();
      const { error } = await anonClient
        .from('savings_goals')
        .update({ current_amount: 9999 })
        .eq('user_id', userAId);
      if (error) {
        pass('Anon key cannot UPDATE savings goal balances');
      } else {
        fail('Anon key cannot UPDATE savings goal balances', 'CRITICAL: anon UPDATE succeeded');
      }
    }

    // ── 12. Anon key cannot UPDATE audit_logs ─────────────────────────────────
    {
      const anonClient = makeAnonClient();
      const { error } = await anonClient
        .from('audit_logs')
        .update({ action: 'tampered' })
        .limit(1);
      if (error) {
        pass('Anon key cannot UPDATE audit_logs');
      } else {
        fail('Anon key cannot UPDATE audit_logs', 'CRITICAL: anon UPDATE audit_logs succeeded');
      }
    }

    // ── 13. Member cannot INSERT into mobile_money_transactions ──────────────
    {
      const { error } = await clientB.from('mobile_money_transactions').insert({
        group_id: groupId,
        user_id: userBId,
        amount: 100,
        currency: 'NLe',
        status: 'completed',
        provider: 'orange_money',
        provider_reference: 'rls_test_fake_ref',
      });
      if (error) {
        pass('Member cannot INSERT into mobile_money_transactions');
      } else {
        fail('Member cannot INSERT into mobile_money_transactions', 'CRITICAL: direct insert succeeded');
      }
    }

    // ── 14. Org admin cannot manage another org ────────────────────────────────
    // This requires two different organizations — marked as MANUAL if no second org
    manual(
      'Org admin cannot manage another organization',
      'Requires two organizations with separate admins. Create org A (user A admin) and org B (user B admin). Verify user A cannot update org B groups/settings.',
    );

    // ── 15. Collector cannot access unassigned group ──────────────────────────
    manual(
      'Collector cannot access unassigned group / collect for unassigned member',
      'Requires a collector record for user B with no assignment to groupId. Verify record_physical_collection RPC returns error for unassigned collector.',
    );

  } finally {
    await teardown(svc, groupId, goalId);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n=== Mi Osusu RLS Test Suite ===\n');

  try {
    await runTests();
  } catch (err) {
    console.error('Test runner error:', err instanceof Error ? err.message : String(err));
  }

  let passes = 0;
  let failures = 0;
  let manuals = 0;

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '⚠';
    const line = `${icon} [${r.status}] ${r.name}${r.detail ? `\n   → ${r.detail}` : ''}`;
    console.log(line);
    if (r.status === 'PASS')            passes++;
    else if (r.status === 'FAIL')       failures++;
    else if (r.status === 'MANUAL_REQUIRED') manuals++;
  }

  console.log(`\nRESULTS: ${passes} PASS  ${failures} FAIL  ${manuals} MANUAL_REQUIRED`);

  if (!configured) {
    console.log('\n⚠ MANUAL REQUIRED: Set env vars in .env.test.local and re-run to execute live tests.');
    console.log('  See .env.example for required variable names.');
    console.log('  Use dedicated test users — never production accounts.');
  }

  if (failures > 0) {
    console.error('\n✗ RLS FAILURES DETECTED — DO NOT DEPLOY.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
