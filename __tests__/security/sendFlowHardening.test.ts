import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../');

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('Security: send flow hardening', () => {
  const select = read('app/(send)/select.tsx');
  const detail = read('app/(send)/detail.tsx');
  const summary = read('app/(send)/summary.tsx');
  const layout = read('app/(send)/_layout.tsx');
  const service = read('src/services/sendPaymentService.ts');
  const createFn = read('supabase/functions/create-send-payment-intent/index.ts');
  const confirmFn = read('supabase/functions/confirm-send-payment/index.ts');
  const migration = read('supabase/migrations/20260606000002_send_payment_intents.sql');

  it('does not pass trusted amount, account, target name, or method into summary route params', () => {
    expect(select).not.toMatch(/prefillAmount|targetName/);
    expect(detail).toContain('paymentIntentId: intent.paymentIntentId');
    // Scope to the push into /(send)/summary: the summary screen must receive
    // ONLY the intent id and re-fetch all financial fields server-side. The
    // separate push into the monime-payment USSD screen may carry a
    // server-returned amount for display (money movement is webhook-driven).
    const summaryPush = detail.match(/router\.push\(\{\s*pathname:\s*'\/\(send\)\/summary'[\s\S]*?\}\);/);
    expect(summaryPush).not.toBeNull();
    expect(summaryPush![0]).not.toMatch(/amount/);
    expect(summaryPush![0]).not.toMatch(/account/);
    expect(summaryPush![0]).not.toMatch(/targetName/);
    expect(summaryPush![0]).not.toMatch(/method/);
  });

  it('summary fetches server preview by intent and does not trust financial route params', () => {
    expect(summary).toContain('fetchSendPaymentIntent(paymentIntentId)');
    expect(summary).not.toMatch(/amount\??:/);
    expect(summary).not.toMatch(/targetName\??:/);
    expect(summary).not.toMatch(/account\??:/);
    expect(summary).not.toMatch(/method\??:/);
  });

  it('removes fake password authorization and stops on biometric failure', () => {
    expect(summary).not.toMatch(/password|secureTextEntry|Password required/i);
    expect(summary).toContain('disableDeviceFallback: true');
    expect(summary).toContain('if (!biometricOk)');
    expect(summary).toContain('Payment was not submitted');
  });

  it('uses server-generated receipts and accurate security copy', () => {
    expect(summary).toContain('receiptToText(receipt)');
    expect(summary).not.toMatch(/makeRef|Date\.now\(\)\.toString|End-to-end encrypted/i);
    expect(summary).toContain('Secured by encrypted connection and server verification.');
  });

  it('rejects unsupported send methods in frontend and backend', () => {
    expect(detail).not.toMatch(/id:\s*['"]bank_transfer['"]|id:\s*['"]card['"]/);
    expect(service).toContain("z.enum(['orange_money', 'afrimoney'])");
    expect(createFn).toContain("new Set(['orange_money', 'afrimoney'])");
  });

  it('has authenticated route guard and required backend artifacts', () => {
    expect(layout).toContain('<Redirect href="/(auth)/login"');
    expect(createFn).toContain('getAuthUser');
    expect(createFn).toContain('payment_intents');
    expect(confirmFn).toContain('confirmation_idempotency_key');
    expect(confirmFn).toContain('receipts');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.payment_intents');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.ledger_entries');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.receipts');
  });

  it('confirm never completes a payment — webhook finalizers own money movement', () => {
    // confirm-send-payment must end in status='processing' and create the
    // Monime payment code; ledger entries + receipts are written ONLY by the
    // webhook finalizer RPCs (finalize_send_payment / finalize_savings_deposit)
    // after Monime confirms the payment.
    expect(confirmFn).toContain("status: 'processing'");
    expect(confirmFn).toContain('createPaymentCode');
    expect(confirmFn).not.toContain("finalStatus = 'completed'");
    expect(confirmFn).not.toContain('initiate_savings_deposit');
    expect(confirmFn).not.toMatch(/from\(['"]ledger_entries['"]\)/);
    expect(confirmFn).not.toMatch(/\.insert\([^)]*receipt_number/s);

    const webhookFn = read('supabase/functions/mobile-money-webhook/index.ts');
    expect(webhookFn).toContain('finalize_send_payment');
    expect(webhookFn).toContain('finalize_savings_deposit');
    expect(webhookFn).toContain('finalize_monime_checkout');
  });

  it('logs sensitive payment events without logging secrets', () => {
    for (const file of [createFn, confirmFn]) {
      expect(file).toContain('audit(');
      expect(file).not.toMatch(/password|otp|refresh_token|access_token/i);
    }
  });
});
