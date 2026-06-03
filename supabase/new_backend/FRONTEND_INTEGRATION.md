# Frontend Integration Notes
# Project: upuhjekwmtjnjksqikdu

## Golden Rule
> The frontend is a display and request layer only.
> It NEVER computes balances, payment status, periods, commissions, or roles.
> Every financial fact shown to the user comes from a server RPC or database view.

---

## What the Frontend MAY Do

| Action | Method |
|---|---|
| Show vault balance | Read from `vault_summary` view or `calculate_vault_balance()` RPC |
| Show savings progress | Read from `savings_summary` view |
| Show group progress | Read from `osusu_group_summary` view |
| Show collector stats | Read from `collector_dashboard_summary` view |
| Submit a payment | INSERT into `contribution_payments` with `status='pending'` only |
| Upload a proof image | INSERT into `payment_proofs` (own uploads only) |
| Request a withdrawal | Call `request_withdrawal()` RPC |
| Create a savings goal | INSERT into `savings_goals` (own only) |
| Mark notification read | UPDATE `notifications` (own only) |
| Create a group | Call `create_osusu_group()` RPC |
| Join a group via invite | Use invite_code to call `add_member_to_group()` RPC |

## What the Frontend Must NEVER Do

| Forbidden Action | Why |
|---|---|
| Compute `vaultBalance = transactions.reduce(...)` | Server ledger is the only truth |
| Set `payment.status = 'approved'` | Status transitions are RPC-only |
| Set `payment.status = 'verified'` from a webhook response | Webhook must hit Edge Function; status set by backend |
| Generate receipt numbers | Server uses `gen_random_bytes()` — not `Date.now()` |
| Insert into `vault_transactions` | No INSERT RLS policy exists — blocked |
| Insert into `savings_transactions` | No INSERT RLS policy exists — blocked |
| Insert into `commissions` | No INSERT RLS policy exists — blocked |
| Insert into `audit_logs` | No INSERT RLS policy exists — blocked |
| Insert into `mobile_money_transactions` | No INSERT RLS policy exists — blocked |
| Read `user_roles` of other users | RLS blocks this |
| Change own role | Only super_admin can write to `user_roles` |
| Read `webhook_payload` column | Never returned by any view or policy |
| Read `passcode_hash` or `secret_pin` | Never returned by any view or policy |
| Read another member's `contribution_payments` | RLS: member_id = auth.uid() only |

---

## Screen → Data Source Mapping

### Home Screen
```typescript
// Single call replaces all client-side aggregations
const { data } = await supabase
  .from('home_dashboard_summary')
  .select('*')
  .single();

// Display: data.active_group_count, data.unread_notifications,
//          data.pending_payments, data.kyc_verified
```

### Vault Screen
```typescript
const { data: vaultData } = await supabase
  .from('vault_summary')
  .select('*')
  .single();
// Display: vaultData.balance (never compute this yourself)

const { data: txns } = await supabase
  .from('vault_transactions')
  .select('id, type, amount, currency, reference, description, created_at')
  .eq('user_id', user.id)
  .order('created_at', { ascending: false });
```

### Osusu / Groups Screen
```typescript
const { data: groups } = await supabase
  .from('osusu_group_summary')
  .select('*');
// Display: groups[n].total_collected, .current_member_count, .progress_pct
// NEVER compute total_collected yourself from payment records
```

### Savings Screen
```typescript
const { data: goals } = await supabase
  .from('savings_summary')
  .select('*');
// Display: goals[n].current_balance, .progress_pct
```

### Collector Screen
```typescript
const { data } = await supabase
  .from('collector_dashboard_summary')
  .select('*')
  .single();

// To record a collection:
const { data: period } = await supabase.rpc('get_next_payable_period', {
  p_group_id: selectedGroupId,
  p_member_id: selectedMemberId,
});
if (!period.found) { /* show "no open period" */ return; }

const { data: result } = await supabase.rpc('record_physical_collection', {
  p_group_id:        selectedGroupId,
  p_member_id:       selectedMemberId,
  p_period_id:       period.period_id,
  p_amount:          group.contribution_amount,  // from server, not typed by user
  p_payment_method:  'cash',
  p_idempotency_key: crypto.randomUUID(),
});
```

### Payment Approval Screen (Admin / Org Admin)
```typescript
// List pending
const { data } = await supabase
  .from('contribution_payments')
  .select('id, amount, receipt_number, status, collected_at, member_id')
  .in('status', ['pending', 'submitted'])
  .eq('group_id', groupId);

// Approve
await supabase.rpc('approve_payment', { p_payment_id: paymentId });

// Reject
await supabase.rpc('reject_payment', {
  p_payment_id: paymentId,
  p_reason: 'Proof image unclear.',
});
```

---

## Auth Error Handling

```typescript
const { data: { user }, error } = await supabase.auth.getUser();
if (error || !user) { router.replace('/login'); return; }

// Role — always from DB
const { data: roleRow } = await supabase
  .from('user_roles')
  .select('role')
  .eq('user_id', user.id)
  .single();

const role = roleRow?.role ?? 'member';
// Gate screens based on role from DB — not from JWT claims
```

---

## Error Pattern for All RPC Calls

```typescript
const { data, error } = await supabase.rpc('record_physical_collection', { ... });

if (error) {
  // Supabase network/auth error
  showToast(error.message);
  return;
}
if (data?.error) {
  // Business logic error from RPC
  showToast(data.error);  // e.g. "Period is locked." / "Amount must be 100 NLe."
  return;
}
// Success
showToast(`Receipt: ${data.receipt_number}`);
```

---

## Package Versions to Pin

```json
{
  "@supabase/supabase-js": "2.x.x",
  "@supabase/ssr": "0.x.x"
}
```
Always commit `package-lock.json` or `yarn.lock`. See Supabase npm security guide.
