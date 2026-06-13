import { describe, expect, it, vi, afterEach } from 'vitest';
import { readEdgeJson } from '../../src/services/edgeFunctionClient';

describe('readEdgeJson', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a flat valid JSON success response', async () => {
    const response = new Response(JSON.stringify({ status: 'processing', ussdCode: '*144#' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(readEdgeJson(response, 'confirm-send-payment')).resolves.toEqual({
      status: 'processing',
      ussdCode: '*144#',
    });
  });

  it('unwraps the standard success envelope', async () => {
    const response = new Response(JSON.stringify({
      success: true,
      data: { status: 'processing', receipt: null },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(readEdgeJson(response, 'confirm-send-payment')).resolves.toEqual({
      status: 'processing',
      receipt: null,
    });
  });

  it('surfaces a valid JSON error response without parsing failures', async () => {
    const response = new Response(JSON.stringify({
      success: false,
      error: 'QMoney is not currently supported. Please use Orange Money or AfriMoney.',
      code: 'UNSUPPORTED_PROVIDER',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(readEdgeJson(response, 'create-send-payment-intent')).rejects.toThrow(/QMoney is not currently supported/);
  });

  it('converts a plain-text backend response into a safe payment message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = new Response('Internal Server Error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });

    await expect(readEdgeJson(response, 'create-send-payment-intent')).rejects.toThrow(
      'We could not process your request at the moment. Please try again shortly.',
    );
  });

  it('converts malformed JSON into a safe payment message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = new Response('{"success":true', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(readEdgeJson(response, 'create-send-payment-intent')).rejects.toThrow(
      'We could not process your request at the moment. Please try again shortly.',
    );
  });

  it('maps missing transaction PIN errors to user-facing copy', async () => {
    const response = new Response(JSON.stringify({
      success: false,
      error: 'transaction_pin_required',
      code: 'TRANSACTION_PIN_REQUIRED',
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(readEdgeJson(response, 'confirm-send-payment')).rejects.toThrow(
      'Enter your Transaction PIN to continue.',
    );
  });

  it('maps invalid provider errors to provider-unavailable copy', async () => {
    const response = new Response(JSON.stringify({
      success: false,
      error: 'Invalid provider',
      code: 'INVALID_PROVIDER',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(readEdgeJson(response, 'initiate-vault-topup')).rejects.toThrow(
      'Payment service is temporarily unavailable. Please try again later.',
    );
  });

  it('maps insufficient balance and incorrect PIN messages', async () => {
    const insufficient = new Response(JSON.stringify({
      success: false,
      error: 'Insufficient vault balance.',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(readEdgeJson(insufficient, 'pay-osusu-from-vault')).rejects.toThrow(
      'Insufficient vault balance. Your Vault has insufficient balance.',
    );

    const incorrectPin = new Response(JSON.stringify({
      success: false,
      error: 'Invalid transaction PIN.',
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(readEdgeJson(incorrectPin, 'confirm-send-payment')).rejects.toThrow(
      'Incorrect Transaction PIN.',
    );
  });
});
