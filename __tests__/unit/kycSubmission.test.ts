/**
 * kycSubmission.test.ts
 *
 * Unit tests for submitKycPackage() in profileService.ts.
 *
 * Verifies:
 *  - Frontend validation catches missing base64 before any upload
 *  - All four files are uploaded in order
 *  - Progress callback fires at expected milestones
 *  - RPC is called with the correct named parameters
 *  - Upload failures produce user-friendly messages (no raw errors leaked)
 *  - RPC errors are forwarded as Error instances
 *  - Double-submission prevention (submitting flag, not tested here — UX concern)
 *  - KYC approval is NEVER set by the frontend (the RPC handles status)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KycDraftState } from '../../src/store/kycDraftStore';
import type { GuarantorForm } from '../../src/utils/validation/kyc';

// ── Mock storageUpload ────────────────────────────────────────────────────────

vi.mock('../../src/services/storageUpload', () => ({
  uploadKycFile: vi.fn(),
  uploadFromUri: vi.fn(),
}));

// supabase is mocked globally in __tests__/setup.ts

// ── Test data factories ───────────────────────────────────────────────────────

function makeDraft(overrides: Partial<KycDraftState> = {}): KycDraftState {
  return {
    idFrontUri:    'file:///id_front.jpg',
    idBackUri:     'file:///id_back.jpg',
    selfieUri:     'file:///selfie.jpg',
    idFrontBase64: 'aWRGcm9udA==',   // base64 for "idFront"
    idBackBase64:  'aWRCYWNr',       // base64 for "idBack"
    selfieBase64:  'c2VsZmll',       // base64 for "selfie"
    idFrontMime:   'image/jpeg',
    idBackMime:    'image/jpeg',
    selfieMime:    'image/jpeg',
    firstName:     'Aminata',
    lastName:      'Koroma',
    phone:         '+23276000001',
    email:         'aminata@example.com',
    dateOfBirth:   '1990-05-15',
    gender:        'female',
    addressLine1:  '12 Wilberforce Street',
    addressLine2:  '',
    city:          'Freetown',
    stateProvince: 'Western Area',
    postalCode:    '',
    countryId:     'uuid-sierra-leone',
    nationalIdType:   'national_id',
    nationalIdNumber: 'SL-12345678',
    ...overrides,
  };
}

function makeGuarantor(overrides: Partial<GuarantorForm> = {}): GuarantorForm {
  return {
    guarantorName:    'Ibrahim Sesay',
    guarantorPhone:   '+23276000002',
    guarantorEmail:   'ibrahim@example.com',
    guarantorAddress: '45 Lumley Beach Road',
    relationship:     'colleague',
    nationalIdType:   'national_id',
    nationalIdNumber: 'SL-99999999',
    ...overrides,
  };
}

const GUARANTOR_BASE64 = 'Z3VhcmFudG9y'; // base64 for "guarantor"
const GUARANTOR_MIME   = 'image/jpeg';

// ── Helper to get mock handles ────────────────────────────────────────────────

async function getMocks() {
  const supabaseMod   = await import('../../src/services/supabase') as unknown as {
    __mockRpc:  ReturnType<typeof vi.fn>;
    __mockFrom: ReturnType<typeof vi.fn>;
  };
  const storageUpload = await import('../../src/services/storageUpload') as unknown as {
    uploadKycFile: ReturnType<typeof vi.fn>;
  };
  return {
    mockRpc:    supabaseMod.__mockRpc,
    mockFrom:   supabaseMod.__mockFrom,
    mockUpload: storageUpload.uploadKycFile,
  };
}

// ── Validation — missing base64 ───────────────────────────────────────────────

describe('submitKycPackage — frontend validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error immediately when idFrontBase64 is null (no upload attempted)', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload } = await getMocks();

    const { error } = await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft({ idFrontBase64: null }),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toMatch(/File data is missing/i);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('returns error when idBackBase64 is null', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload } = await getMocks();

    const { error } = await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft({ idBackBase64: null }),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    expect(error).toBeInstanceOf(Error);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('returns error when selfieBase64 is null', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload } = await getMocks();

    const { error } = await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft({ selfieBase64: null }),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    expect(error).toBeInstanceOf(Error);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('returns error when guarantorBase64 is empty string', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload } = await getMocks();

    const { error } = await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: '',
      guarantorMime:   GUARANTOR_MIME,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toMatch(/Guarantor ID document data is missing/i);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('returns error when idFrontUri is null (URI check before base64 check)', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload } = await getMocks();

    const { error } = await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft({ idFrontUri: null }),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toMatch(/Missing ID or selfie photos/i);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

// ── Upload flow ───────────────────────────────────────────────────────────────

describe('submitKycPackage — upload flow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads exactly 4 files (front, back, selfie, guarantor) on success', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'kyc/user-1/sub-1/file.jpg', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    expect(mockUpload).toHaveBeenCalledTimes(4);
  });

  it('each upload is called with a path under kyc/{userId}/', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'kyc/user-1/sub-1/file.jpg', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    for (const call of mockUpload.mock.calls) {
      const path: string = call[0];
      expect(path).toMatch(/^kyc\/user-1\//);
    }
  });

  it('passes correct base64 and mimeType for each upload', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'kyc/user-1/sub-1/file.jpg', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    const draft = makeDraft({
      idFrontBase64: 'frontB64',
      idFrontMime:   'image/jpeg',
      idBackBase64:  'backB64',
      idBackMime:    'image/png',
      selfieBase64:  'selfieB64',
      selfieMime:    'image/jpeg',
    });

    await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft,
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   'image/png',
    });

    const payloads = mockUpload.mock.calls.map((c: unknown[]) => c[1] as { base64: string; mimeType: string });

    expect(payloads[0]).toMatchObject({ base64: 'frontB64',      mimeType: 'image/jpeg' });
    expect(payloads[1]).toMatchObject({ base64: 'backB64',       mimeType: 'image/png' });
    expect(payloads[2]).toMatchObject({ base64: 'selfieB64',     mimeType: 'image/jpeg' });
    expect(payloads[3]).toMatchObject({ base64: GUARANTOR_BASE64, mimeType: 'image/png' });
  });

  it('aborts on first upload failure and returns user-friendly error', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    // First upload fails
    mockUpload
      .mockResolvedValueOnce({ storagePath: null, error: new Error('Network timeout') })
      // Subsequent calls would succeed but should not be reached
      .mockResolvedValue({ storagePath: 'ok', error: null });

    const { error } = await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    expect(error).toBeInstanceOf(Error);
    // Should mention the file label, not expose the raw DB error
    expect(error!.message).toMatch(/ID front/i);
    expect(error!.message).toMatch(/Network timeout/i);
    // Only 1 upload should have been attempted
    expect(mockUpload).toHaveBeenCalledTimes(1);
    // RPC must NOT be called
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('does NOT call submit_kyc_package RPC with kyc_status=approved', async () => {
    // SECURITY RULE: kyc_status=approved must never be set from the frontend.
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'kyc/user-1/sub-1/file.jpg', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    // The RPC call args must not contain any 'approved' value
    const rpcArgs = mockRpc.mock.calls[0];
    const paramsJson = JSON.stringify(rpcArgs);
    expect(paramsJson).not.toContain('approved');
  });
});

// ── RPC call ─────────────────────────────────────────────────────────────────

describe('submitKycPackage — RPC call', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls the submit_kyc_package RPC (not any other RPC)', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'kyc/user-1/sub-1/file.jpg', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][0]).toBe('submit_kyc_package');
  });

  it('passes personal details to RPC as named params', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'kyc/user-1/sub-1/file.jpg', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(params.p_first_name).toBe('Aminata');
    expect(params.p_last_name).toBe('Koroma');
    expect(params.p_phone).toBe('+23276000001');
    expect(params.p_national_id_type).toBe('national_id');
    expect(params.p_national_id_number).toBe('SL-12345678');
  });

  it('passes p_submission_id as a UUID string to the RPC', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'kyc/user-1/sub-1/file.jpg', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof params.p_submission_id).toBe('string');
    // Should be a UUID v4 pattern
    expect(params.p_submission_id as string).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('passes storage paths matching kyc/{userId}/{submissionId}/ prefix', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'kyc/user-1/sub-1/file.jpg', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    const subId  = params.p_submission_id as string;

    expect((params.p_national_id_front_url as string)).toContain(`kyc/user-1/${subId}/`);
    expect((params.p_national_id_back_url  as string)).toContain(`kyc/user-1/${subId}/`);
    expect((params.p_selfie_url            as string)).toContain(`kyc/user-1/${subId}/`);
    expect((params.p_guarantor_doc_url     as string)).toContain(`kyc/user-1/${subId}/`);
  });

  it('returns error when RPC itself errors (Supabase network error)', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'ok', error: null });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Connection refused' } });

    const { error } = await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toBe('Connection refused');
  });

  it('returns error when RPC returns { error: "..." } in payload', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'ok', error: null });
    mockRpc.mockResolvedValue({
      data: { error: 'You must be at least 18 years old to complete KYC.' },
      error: null,
    });

    const { error } = await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toBe('You must be at least 18 years old to complete KYC.');
  });

  it('returns { error: null } on full success', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'ok', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    const { error } = await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    expect(error).toBeNull();
  });
});

// ── Progress callback ─────────────────────────────────────────────────────────

describe('submitKycPackage — progress callback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires onProgress at 0% before first upload and 100% after RPC', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'ok', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    const progress: number[] = [];
    await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
      onProgress:      (pct) => progress.push(pct),
    });

    expect(progress[0]).toBe(0);               // before first upload
    expect(progress[progress.length - 1]).toBe(100); // after RPC
    expect(progress.some((p) => p === 85)).toBe(true); // pre-RPC milestone
  });

  it('progress never decreases and never exceeds 100', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'ok', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    const progress: number[] = [];
    await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
      onProgress:      (pct) => progress.push(pct),
    });

    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
    expect(Math.max(...progress)).toBeLessThanOrEqual(100);
  });

  it('works fine when onProgress is undefined (no crash)', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'ok', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    await expect(
      submitKycPackage({
        userId:          'user-1',
        authEmail:       'user@example.com',
        draft:           makeDraft(),
        guarantor:       makeGuarantor(),
        guarantorBase64: GUARANTOR_BASE64,
        guarantorMime:   GUARANTOR_MIME,
        // onProgress intentionally omitted
      }),
    ).resolves.toEqual({ error: null });
  });
});

// ── Security rules ────────────────────────────────────────────────────────────

describe('submitKycPackage — security rules', () => {
  beforeEach(() => vi.clearAllMocks());

  it('NEVER sets kyc_status on the frontend (no direct profiles update)', async () => {
    // The frontend must never update profiles.kyc_status directly.
    // All status changes go through the SECURITY DEFINER RPC.
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc, mockFrom } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'ok', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    await submitKycPackage({
      userId:          'user-1',
      authEmail:       'user@example.com',
      draft:           makeDraft(),
      guarantor:       makeGuarantor(),
      guarantorBase64: GUARANTOR_BASE64,
      guarantorMime:   GUARANTOR_MIME,
    });

    // supabase.from() should NOT be called by submitKycPackage at all
    // (no direct DB writes — everything goes through the RPC)
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('generates a unique submission ID for each call', async () => {
    const { submitKycPackage } = await import('../../src/services/profileService');
    const { mockUpload, mockRpc } = await getMocks();

    mockUpload.mockResolvedValue({ storagePath: 'ok', error: null });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    // Call twice
    await submitKycPackage({
      userId: 'user-1', authEmail: 'user@example.com', draft: makeDraft(),
      guarantor: makeGuarantor(), guarantorBase64: GUARANTOR_BASE64, guarantorMime: GUARANTOR_MIME,
    });
    await submitKycPackage({
      userId: 'user-1', authEmail: 'user@example.com', draft: makeDraft(),
      guarantor: makeGuarantor(), guarantorBase64: GUARANTOR_BASE64, guarantorMime: GUARANTOR_MIME,
    });

    const subId1 = (mockRpc.mock.calls[0][1] as Record<string, unknown>).p_submission_id;
    const subId2 = (mockRpc.mock.calls[1][1] as Record<string, unknown>).p_submission_id;
    expect(subId1).not.toBe(subId2);
  });
});

