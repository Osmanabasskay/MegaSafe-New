/**
 * Savings deposit flow tests (send → savings via Monime)
 *
 * Verifies the CRITICAL fix: savings deposits collect real money.
 *
 *   1. confirm-send-payment returns status='processing' + a Monime payment
 *      code (USSD) for savings — NEVER 'completed', NEVER a receipt.
 *   2. The payment-code reference is surfaced so the frontend can poll.
 *   3. Completion (receipt) only appears on idempotent replay AFTER the
 *      webhook has finalized — the client cannot self-complete.
 *   4. Unsupported provider / KYC-blocked numbers surface the backend's
 *      clear error messages.
 *
 * The edge function itself runs in Deno; these tests exercise the
 * sendPaymentService contract against mocked edge responses that mirror the
 * exact response shapes of confirm-send-payment/index.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { confirmSendPayment } from '../../src/services/sendPaymentService';
import * as _supabaseMock from '../../src/services/supabase';

type MockHandles = {
  __mockAuth: { getSession: ReturnType<typeof vi.fn> };
};
const getMocks = () => _supabaseMock as unknown as MockHandles;

const INTENT_ID = '11111111-1111-4111-8111-111111111111';
const IDEM_KEY  = '22222222-2222-4222-8222-222222222222';

function authedSession() {
  getMocks().__mockAuth.getSession.mockResolvedValueOnce({
    data: { session: { access_token: 'jwt-token' } },
  });
}

function confirmInput() {
  return {
    paymentIntentId: INTENT_ID,
    idempotencyKey:  IDEM_KEY,
    localAuthMethod: 'biometric' as const,
    transactionPin:  '1234',
  };
}

describe('savings deposit via send flow (real money collection)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns processing + USSD payment code — does NOT complete without webhook', async () => {
    authedSession();
    // Mirrors confirm-send-payment savings-branch success response.
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'processing',
        receipt: null,
        providerReference: 'pc_sav_123',
        monimePaymentCodeId: 'pc_sav_123',
        ussdCode: '*144*5*987654#',
        expiresAt: '2026-06-11T12:00:00Z',
        mmTxnId: '33333333-3333-4333-8333-333333333333',
        paymentType: 'savings_deposit',
      }),
    });

    const { status, receipt, paymentCode, error } = await confirmSendPayment(confirmInput());

    expect(error).toBeNull();
    expect(status).toBe('processing');
    expect(receipt).toBeNull();                       // no receipt before webhook
    expect(paymentCode).not.toBeNull();               // Monime payment code created
    expect(paymentCode?.monimePaymentCodeId).toBe('pc_sav_123');
    expect(paymentCode?.ussdCode).toBe('*144*5*987654#');   // USSD shown to user
    expect(paymentCode?.paymentType).toBe('savings_deposit');
  });

  it('stores/propagates the payment code reference for status polling', async () => {
    authedSession();
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'processing',
        receipt: null,
        providerReference: 'pc_sav_ref',
        monimePaymentCodeId: 'pc_sav_ref',
        ussdCode: '*144*5*111222#',
        expiresAt: null,
        mmTxnId: null,
        paymentType: 'savings_deposit',
      }),
    });

    const { paymentCode } = await confirmSendPayment(confirmInput());
    expect(paymentCode?.providerReference).toBe('pc_sav_ref');
  });

  it('returns the completed receipt ONLY on replay after webhook finalization', async () => {
    authedSession();
    // Mirrors the idempotent-replay branch: webhook already ran
    // finalize_savings_deposit, which generated the receipt.
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'completed',
        receipt: {
          receiptNumber: 'RCPT-ABCDEF1234567890',
          transactionId: '44444444-4444-4444-8444-444444444444',
          paymentIntentId: INTENT_ID,
          status: 'completed',
          timestamp: '2026-06-11T12:05:00Z',
          amount: 250,
          currency: 'NLe',
          maskedAccount: '•••• 1234',
          providerReference: 'pc_sav_123',
        },
      }),
    });

    const { status, receipt, paymentCode } = await confirmSendPayment(confirmInput());
    expect(status).toBe('completed');
    expect(receipt?.receiptNumber).toBe('RCPT-ABCDEF1234567890');
    expect(paymentCode).toBeNull(); // replay returns the receipt, not a new code
  });

  it('surfaces the QMoney rejection message from the backend', async () => {
    authedSession();
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'QMoney is not currently supported. Please use Orange Money or AfriMoney.',
      }),
    });

    const { error } = await confirmSendPayment(confirmInput());
    expect(error?.message).toMatch(/QMoney is not currently supported/);
  });

  it('surfaces the unregistered-number (provider KYC) rejection', async () => {
    authedSession();
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        error: 'This number is not registered with Orange Money or AfriMoney. Please use a valid mobile money number.',
      }),
    });

    const { error, receipt, paymentCode } = await confirmSendPayment(confirmInput());
    expect(error?.message).toMatch(/not registered with Orange Money or AfriMoney/);
    expect(receipt).toBeNull();
    expect(paymentCode).toBeNull();   // payment code is never created when KYC blocks
  });

  it('fails safely when the provider KYC service is unavailable (strict mode)', async () => {
    authedSession();
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({
        error: 'We could not verify your mobile money number right now. Please try again in a few minutes.',
      }),
    });

    const { error, paymentCode } = await confirmSendPayment(confirmInput());
    expect(error).toBeInstanceOf(Error);
    expect(paymentCode).toBeNull();
  });

  it('sends the transaction PIN and idempotency key to the backend', async () => {
    authedSession();
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'processing', receipt: null }),
    });

    await confirmSendPayment(confirmInput());

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(fetchCall[0])).toMatch(/confirm-send-payment$/);
    const body = JSON.parse(fetchCall[1].body as string) as Record<string, unknown>;
    expect(body.payment_intent_id).toBe(INTENT_ID);
    expect(body.idempotency_key).toBe(IDEM_KEY);
    expect(body.local_auth_method).toBe('biometric');
    expect(body.transaction_pin).toBe('1234');
  });
});
