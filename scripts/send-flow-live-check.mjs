import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const envPath = path.join(root, '.env');

const env = {
  ...process.env,
  ...Object.fromEntries(
    fs.existsSync(envPath)
      ? fs
          .readFileSync(envPath, 'utf8')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#') && line.includes('='))
          .map((line) => {
            const [key, ...rest] = line.split('=');
            return [key, rest.join('=')];
          })
      : []
  ),
};

const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const accessToken = env.SEND_FLOW_TEST_ACCESS_TOKEN;

if (!supabaseUrl || !anonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.');
}

const checks = [];

const record = (name, ok, details = '') => {
  checks.push({ name, ok, details });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark} ${name}${details ? ` - ${details}` : ''}`);
};

const rest = async (table, body, token) => {
  const headers = {
    apikey: anonKey,
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  return fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
};

const invoke = async (name, body, token) => {
  const headers = {
    apikey: anonKey,
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  return fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
};

const randomUuid = () => crypto.randomUUID();
const nowBody = {
  user_id: randomUuid(),
  payment_intent_id: randomUuid(),
  transaction_id: `live-check-${Date.now()}`,
  amount: 1,
  currency: 'NLe',
};

for (const table of ['payment_intents', 'ledger_entries', 'receipts']) {
  const body =
    table === 'payment_intents'
      ? {
          user_id: randomUuid(),
          target_type: 'group',
          target_id: randomUuid(),
          target_name: 'Live check',
          amount: 1,
          method: 'orange_money',
          payment_method_id: randomUuid(),
          masked_account: '****0000',
          idempotency_key: randomUuid(),
        }
      : table === 'ledger_entries'
        ? { ...nowBody, entry_type: 'debit', description: 'Live check' }
        : {
            ...nowBody,
            receipt_number: `CHECK-${Date.now()}`,
            status: 'completed',
            masked_account: '****0000',
            idempotency_key: randomUuid(),
          };

  const anonRes = await rest(table, body);
  record(`${table} blocks anonymous direct insert`, anonRes.status >= 400, `status ${anonRes.status}`);

  if (accessToken) {
    const authRes = await rest(table, body, accessToken);
    record(`${table} blocks authenticated direct insert`, authRes.status >= 400, `status ${authRes.status}`);
  }
}

const invalidJwtRes = await invoke(
  'create-send-payment-intent',
  {
    targetType: 'group',
    targetId: randomUuid(),
    amount: 10,
    method: 'orange_money',
    paymentMethodId: randomUuid(),
    idempotencyKey: randomUuid(),
  },
  'invalid.jwt.token'
);
record('create-send-payment-intent rejects invalid JWT', invalidJwtRes.status === 401, `status ${invalidJwtRes.status}`);

const noJwtConfirmRes = await invoke(
  'confirm-send-payment',
  {
    paymentIntentId: randomUuid(),
    confirmationIdempotencyKey: randomUuid(),
  }
);
record('confirm-send-payment rejects missing JWT', noJwtConfirmRes.status === 401, `status ${noJwtConfirmRes.status}`);

if (accessToken) {
  const unauthorizedTargetRes = await invoke(
    'create-send-payment-intent',
    {
      targetType: 'group',
      targetId: randomUuid(),
      amount: 10,
      method: 'orange_money',
      paymentMethodId: randomUuid(),
      idempotencyKey: randomUuid(),
    },
    accessToken
  );
  record(
    'create-send-payment-intent rejects unauthorized target',
    unauthorizedTargetRes.status >= 400,
    `status ${unauthorizedTargetRes.status}`
  );

  const badAmountRes = await invoke(
    'create-send-payment-intent',
    {
      targetType: 'goal',
      targetId: randomUuid(),
      amount: -1,
      method: 'orange_money',
      paymentMethodId: randomUuid(),
      idempotencyKey: randomUuid(),
    },
    accessToken
  );
  record('create-send-payment-intent rejects tampered amount', badAmountRes.status === 400, `status ${badAmountRes.status}`);
} else {
  console.log('SKIP authenticated target/amount checks - set SEND_FLOW_TEST_ACCESS_TOKEN to run them.');
}

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} live send-flow check(s) failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} live send-flow checks passed.`);
