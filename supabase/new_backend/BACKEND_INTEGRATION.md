# Backend Integration Notes
# Project: upuhjekwmtjnjksqikdu

## Project URL
```
https://upuhjekwmtjnjksqikdu.supabase.co
```

## Environment Variables Required

### Mobile App (Expo / React Native)
```env
EXPO_PUBLIC_SUPABASE_URL=https://upuhjekwmtjnjksqikdu.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon key from Dashboard>
```

### Admin Panel (Next.js — server-side only)
```env
NEXT_PUBLIC_SUPABASE_URL=https://upuhjekwmtjnjksqikdu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SECRET_KEY=<service_role key — NEVER in frontend>
```

### Edge Functions (set via Dashboard > Edge Functions > Secrets)
```
MOBILE_MONEY_API_KEY=<provider key>
MOBILE_MONEY_WEBHOOK_SECRET=<webhook HMAC secret>
ORANGE_MONEY_API_KEY=
AFRIMONEY_API_KEY=
QMONEY_API_KEY=
```

---

## RPC Call Reference

All calls use `supabase.rpc('function_name', { params })`.
All RPCs return `{ success: true, ... }` or `{ error: 'message' }`.
Never trust the response shape — always check for `error` first.

### Groups
```typescript
// Create group
const { data } = await supabase.rpc('create_osusu_group', {
  p_name: 'My Group',
  p_frequency: 'weekly',
  p_contribution_amount: 100,
  p_max_members: 10,
  p_cycle_start_date: '2025-06-01',
  p_total_cycles: 10,
});

// Add member
await supabase.rpc('add_member_to_group', {
  p_group_id: '...',
  p_user_id: '...',
  p_payout_position: 2,
});

// Generate schedule (after all members added)
await supabase.rpc('generate_contribution_schedule', {
  p_group_id: '...',
});
```

### Collections
```typescript
// Get next payable period for a member
const { data } = await supabase.rpc('get_next_payable_period', {
  p_group_id: '...',
  p_member_id: '...',
});

// Record physical collection (collector only)
const { data } = await supabase.rpc('record_physical_collection', {
  p_group_id: '...',
  p_member_id: '...',
  p_period_id: data.period_id,   // from get_next_payable_period
  p_amount: 100,
  p_payment_method: 'cash',
  p_idempotency_key: crypto.randomUUID(),
});
```

### Approvals
```typescript
// Approve payment (group manager / super_admin only)
await supabase.rpc('approve_payment', { p_payment_id: '...' });

// Reject payment
await supabase.rpc('reject_payment', {
  p_payment_id: '...',
  p_reason: 'Incorrect amount submitted.',
});
```

### Balances (always from server)
```typescript
// Vault balance — NEVER compute client-side
const { data } = await supabase.rpc('calculate_vault_balance');

// Savings goal balance
const { data } = await supabase.rpc('calculate_savings_balance', {
  p_goal_id: '...',
});

// Group progress
const { data } = await supabase.rpc('calculate_group_progress', {
  p_group_id: '...',
});
```

### Withdrawals
```typescript
// Request withdrawal
await supabase.rpc('request_withdrawal', {
  p_amount: 500,
  p_destination_provider: 'orange_money',
  p_destination_number: '+23276000000',
  p_vault_id: '...',
  p_idempotency_key: crypto.randomUUID(),
});
```

---

## Dashboard Views (read-only, safe for frontend)

```typescript
// Home screen
const { data } = await supabase.from('home_dashboard_summary').select('*').single();

// Vault screen
const { data } = await supabase.from('vault_summary').select('*').single();

// Osusu groups list
const { data } = await supabase.from('osusu_group_summary').select('*');

// Savings goals
const { data } = await supabase.from('savings_summary').select('*');

// Collector screen
const { data } = await supabase.from('collector_dashboard_summary').select('*').single();
```

---

## Auth Setup

### Sign Up
```typescript
await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'securepassword',
  options: {
    data: { full_name: 'Aminata Koroma', phone: '+23276123456' }
  }
});
// Profile + member role created automatically via triggers
```

### Get Role (always from DB, not JWT)
```typescript
const { data } = await supabase
  .from('user_roles')
  .select('role')
  .eq('user_id', user.id)
  .single();
// Never use user.app_metadata.role — JWT claims can be stale
```

---

## Edge Functions Required (not yet deployed)

| Function | Trigger | Purpose |
|---|---|---|
| `initiate-payment` | Client RPC | Start mobile money payment, create pending MMT record |
| `payment-webhook` | Provider POST | Verify HMAC, update MMT status, trigger approve_payment |
| `send-notification` | DB trigger / RPC | Push/SMS delivery |
| `auto-save-sweep` | pg_cron daily | Server-side auto-save execution |

---

## Critical Rules

1. **Never compute balances on the frontend.** Always call `calculate_vault_balance()` RPC.
2. **Never set payment status from the frontend.** Status transitions only happen via RPCs.
3. **Never use `service_role` key in Expo/React Native code** — only in Edge Functions and Next.js API routes.
4. **Always use idempotency keys** for collection and withdrawal RPCs to prevent duplicate records on retry.
5. **Always read user role from `user_roles` table**, not from `auth.jwt()` or `user.app_metadata`.
