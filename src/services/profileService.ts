import { supabase } from './supabase';
import type { KycDraftState } from '../store/kycDraftStore';
import { useKycDraftStore } from '../store/kycDraftStore';
import { uploadFromUri, uploadKycFile } from './storageUpload';
import type { GuarantorForm } from '../utils/validation/kyc';
import { isValidSierraLeonePhone, normalizeToSierraLeone } from './auth/phone';

/**
 * Matches profiles.kyc_status CHECK constraint in the DB.
 * 'submitted' is a legacy value written by the old RPC; new submissions use 'pending'.
 * The frontend treats both 'submitted' and 'pending' as "under review".
 */
export type KycStatus = 'not_submitted' | 'pending' | 'submitted' | 'approved' | 'rejected';

type BackendKycValidationAction = 'submitted_for_review' | 'manual_review' | 'retake_required';

/**
 * Columns returned by fetchProfile. Intentionally limited to what the mobile
 * app actually reads — KYC document URLs, national ID, address fields, and
 * other admin-only data are excluded to minimise over-exposure.
 */
export interface ProfileRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  kyc_status: KycStatus | null;
  kyc_rejection_reason: string | null;
}

export interface CountryRow {
  id: string;
  name: string;
  code: string;
  is_default: boolean;
}

export interface CountryRegionCity {
  id: string;
  name: string;
  province_id: string | null;
  province_name: string | null;
}

export interface CountryRegionProvince {
  id: string;
  name: string;
}

// ── KYC audit logger (fire-and-forget, never throws) ─────────────────────────
//
// Logs KYC lifecycle events to the audit_logs table via the same SECURITY
// DEFINER RPC used by the auth store. Only non-PII metadata is logged —
// no ID numbers, names, base64 data, or document images.
function logKycAudit(
  userId: string,
  action: string,
  data: Record<string, unknown>,
): void {
  void supabase
    .rpc('create_audit_log', {
      p_action:     action,
      p_table_name: 'kyc_submissions',
      p_record_id:  userId,
      p_old_data:   null,
      p_new_data:   data,
    })
    .then(undefined, () => {}); // fire-and-forget; never blocks submission
}

// ── UUID v4 generator (no external dep needed) ────────────────────────────────
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function requestBackendKycValidation(params: {
  userId: string;
  submissionId: string;
  applicationId: string;
}): Promise<{ action: BackendKycValidationAction | null; error: Error | null }> {
  const { data, error } = await supabase.functions.invoke('validate-kyc-identity', {
    body: { application_id: params.applicationId },
  });

  if (error) {
    if (__DEV__) {
      console.warn('[KYC] validate-kyc-identity function error:', error.message);
    }
    logKycAudit(params.userId, 'kyc_backend_validation_unavailable', {
      submission_id: params.submissionId,
      application_id: params.applicationId,
    });
    return { action: null, error: new Error(error.message) };
  }

  const action = (data as { action?: BackendKycValidationAction } | null)?.action ?? null;
  logKycAudit(params.userId, 'kyc_backend_validation_completed', {
    submission_id: params.submissionId,
    application_id: params.applicationId,
    action: action ?? 'unknown',
  });
  return { action, error: null };
}

/**
 * Fetches English-speaking African countries via the get_countries() SECURITY
 * DEFINER RPC. The backend controls which countries appear, their sort order
 * (Sierra Leone pinned first), and which country is the default. The frontend
 * does nothing except render what it receives.
 *
 * Returns `defaultId` — the UUID of the default country (Sierra Leone) — so
 * the screen can pre-select it without any client-side filtering logic.
 */
export async function fetchCountries(): Promise<{
  data: CountryRow[];
  defaultId: string | null;
  error: Error | null;
}> {
  const { data, error } = await supabase.rpc('get_countries');

  if (error) return { data: [], defaultId: null, error: new Error(error.message) };

  const result = data as Record<string, unknown> | null;
  if (!result || result.error) {
    return {
      data: [],
      defaultId: null,
      error: new Error((result?.error as string) ?? 'Could not load countries.'),
    };
  }

  const rows = (result.countries as unknown[]) ?? [];
  return {
    data: rows.map((c) => {
      const r = c as Record<string, unknown>;
      return {
        id:         r.id as string,
        name:       r.name as string,
        code:       r.code as string,
        is_default: Boolean(r.is_default),
      };
    }),
    defaultId: (result.default_id as string | null) ?? null,
    error:     null,
  };
}

/**
 * Fetches cities and provinces for a given country via the get_country_regions()
 * SECURITY DEFINER RPC. All region data (names, hierarchy, sort order) is
 * controlled entirely by the backend — the frontend only renders what it receives.
 */
export async function fetchCountryRegions(countryId: string): Promise<{
  cities: CountryRegionCity[];
  provinces: CountryRegionProvince[];
  error: Error | null;
}> {
  const { data, error } = await supabase.rpc('get_country_regions', { p_country_id: countryId });
  if (error) return { cities: [], provinces: [], error: new Error(error.message) };

  const result = data as Record<string, unknown> | null;
  if (!result) return { cities: [], provinces: [], error: null };

  const rawCities = (result.cities as unknown[]) ?? [];
  const rawProvinces = (result.provinces as unknown[]) ?? [];

  return {
    cities: rawCities.map((c) => {
      const r = c as Record<string, unknown>;
      return {
        id:            r.id as string,
        name:          r.name as string,
        province_id:   (r.province_id as string | null) ?? null,
        province_name: (r.province_name as string | null) ?? null,
      };
    }),
    provinces: rawProvinces.map((p) => {
      const r = p as Record<string, unknown>;
      return { id: r.id as string, name: r.name as string };
    }),
    error: null,
  };
}

const PROFILE_COLUMNS =
  'id, email, first_name, last_name, phone, avatar_url, kyc_status, kyc_rejection_reason';

export async function fetchProfile(userId: string): Promise<{
  profile: ProfileRow | null;
  error: Error | null;
}> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) return { profile: null, error: new Error(error.message) };
  return { profile: data as ProfileRow | null, error: null };
}

export async function fetchGuarantorForUser(userId: string): Promise<{
  guarantor: { name: string; phone: string; relationship: string } | null;
  error: Error | null;
}> {
  const { data, error } = await supabase
    .from('guarantors')
    .select('name, phone, relationship')
    .eq('member_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { guarantor: null, error: new Error(error.message) };
  return { guarantor: data as { name: string; phone: string; relationship: string } | null, error: null };
}

/**
 * submitKycPackage — the single frontend entry point for KYC submission.
 *
 * Flow:
 *  1. Validate all files are present and have base64 data (from picker).
 *  2. Generate a server-unique submissionId (UUID v4).
 *  3. Upload all files to private bucket path: kyc/{userId}/{submissionId}/
 *  4. Call the submit_kyc_package SECURITY DEFINER RPC.
 *     The RPC validates paths, creates DB records, sets kyc_status = 'pending'.
 *
 * Security guarantees:
 *  - All DB writes go through the backend RPC (SECURITY DEFINER).
 *  - File paths include the user's UID; the RPC validates them server-side.
 *  - kyc_status is NEVER set to 'approved' here. Only the RPC sets 'pending'.
 *  - No service-role key is used or exposed.
 *  - base64 data is NOT stored persistently; it lives only in memory during upload.
 */
export async function submitKycPackage(params: {
  userId: string;
  authEmail: string;
  draft: KycDraftState;
  guarantor: GuarantorForm;
  /** Raw base64 for the guarantor ID document (no data: prefix). */
  guarantorBase64: string;
  /** MIME type for the guarantor ID document. */
  guarantorMime: string;
  /** Optional upload progress callback (0–100). */
  onProgress?: (pct: number) => void;
}): Promise<{ error: Error | null }> {
  const { userId, draft, guarantor, guarantorBase64, guarantorMime, onProgress } = params;

  // ── 1. Validate all required base64 data ────────────────────────────────────
  if (!draft.idFrontUri || !draft.idBackUri || !draft.selfieUri) {
    return { error: new Error('Missing ID or selfie photos. Please complete all steps.') };
  }
  if (!draft.idFrontBase64 || !draft.idBackBase64 || !draft.selfieBase64) {
    return {
      error: new Error(
        'File data is missing. Please go back to the photo steps and re-select your images.',
      ),
    };
  }
  if (!guarantorBase64) {
    return { error: new Error('Guarantor ID document data is missing. Please upload it again.') };
  }

  // ── 1b. Normalise & validate Sierra Leone phone numbers ─────────────────────
  // profiles.phone has a DB CHECK constraint (^\+232[0-9]{8}$). The UI shows a
  // "+232" label but the form stores only the local digits the user typed, so we
  // canonicalise here BEFORE any upload — otherwise the RPC's profiles update
  // violates the constraint and rolls back the entire submission.
  const normalizedPhone = normalizeToSierraLeone(draft.phone ?? '');
  if (!isValidSierraLeonePhone(normalizedPhone)) {
    return {
      error: new Error(
        'Enter a valid Sierra Leone phone number — 8 digits after +232 (e.g. 088 123 456).',
      ),
    };
  }
  const normalizedGuarantorPhone = normalizeToSierraLeone(guarantor.guarantorPhone ?? '');
  if (!isValidSierraLeonePhone(normalizedGuarantorPhone)) {
    return {
      error: new Error(
        "Enter a valid Sierra Leone phone number for the guarantor — 8 digits after +232.",
      ),
    };
  }

  // ── 2. Generate submission UUID (path-safe, unique per submission) ──────────
  const submissionId = generateUUID();

  // Audit: KYC flow entered — logged before uploads so a crash mid-upload
  // still leaves a record that submission was attempted.
  logKycAudit(userId, 'kyc_submission_started', { submission_id: submissionId });
  const base = `kyc/${userId}/${submissionId}`;

  // Derive file extensions from stored MIME types
  const ext = (mime: string) =>
    mime === 'image/png' ? 'png' : mime === 'application/pdf' ? 'pdf' : 'jpg';

  const paths = {
    front:        `${base}/id_front.${ext(draft.idFrontMime)}`,
    back:         `${base}/id_back.${ext(draft.idBackMime)}`,
    selfie:       `${base}/selfie.${ext(draft.selfieMime)}`,
    guarantorDoc: `${base}/guarantor_id.${ext(guarantorMime)}`,
  };

  // ── 3. Upload files sequentially (bail on first failure) ────────────────────
  const uploads: Array<{ path: string; base64: string; mimeType: string; label: string }> = [
    { path: paths.front,        base64: draft.idFrontBase64, mimeType: draft.idFrontMime, label: 'ID front'  },
    { path: paths.back,         base64: draft.idBackBase64,  mimeType: draft.idBackMime,  label: 'ID back'   },
    { path: paths.selfie,       base64: draft.selfieBase64,  mimeType: draft.selfieMime,  label: 'selfie'    },
    { path: paths.guarantorDoc, base64: guarantorBase64,     mimeType: guarantorMime,     label: 'guarantor' },
  ];

  for (let i = 0; i < uploads.length; i++) {
    const u = uploads[i];
    onProgress?.(Math.round((i / uploads.length) * 80)); // 0 → 80 during uploads

    const { error: uploadError } = await uploadKycFile(u.path, {
      base64:   u.base64,
      mimeType: u.mimeType,
    });

    if (uploadError) {
      if (__DEV__) {
        console.warn(`[KYC] Upload failed (${u.label}):`, uploadError.message);
      }
      logKycAudit(userId, 'kyc_upload_failed', {
        submission_id: submissionId,
        document_slot: u.label,
      });
      return {
        error: new Error(
          `Could not upload your ${u.label} photo. Please check your connection and try again.`,
        ),
      };
    }
  }

  // Clear base64 image buffers from Zustand now that all files are uploaded.
  // This wipes sensitive identity-document imagery from in-memory state before
  // the RPC call, so a crash during the RPC does not leave raw images in the store.
  useKycDraftStore.getState().clearImageBuffers();

  onProgress?.(85); // uploads done, calling RPC

  // ── 4. Submit via SECURITY DEFINER RPC ──────────────────────────────────────
  const { data, error: rpcError } = await supabase.rpc('submit_kyc_package', {
    p_submission_id:           submissionId,
    p_first_name:              draft.firstName.trim(),
    p_last_name:               draft.lastName.trim(),
    p_phone:                   normalizedPhone,
    p_date_of_birth:           draft.dateOfBirth,
    p_gender:                  draft.gender || null,
    p_address_line1:           draft.addressLine1.trim(),
    p_address_line2:           draft.addressLine2?.trim() ?? '',
    p_city:                    draft.city.trim(),
    p_state_province:          draft.stateProvince?.trim() ?? '',
    p_postal_code:             draft.postalCode?.trim() ?? '',
    p_country_id:              draft.countryId ?? null,
    p_national_id_number:      draft.nationalIdNumber.trim(),
    p_national_id_type:        draft.nationalIdType,
    p_national_id_front_url:   paths.front,
    p_national_id_back_url:    paths.back,
    p_selfie_url:              paths.selfie,
    p_guarantor_name:          guarantor.guarantorName.trim(),
    p_guarantor_phone:         normalizedGuarantorPhone,
    p_guarantor_email:         guarantor.guarantorEmail?.trim() ?? '',
    p_guarantor_address:       guarantor.guarantorAddress.trim(),
    p_guarantor_relationship:  guarantor.relationship.trim(),
    p_guarantor_id_number:     guarantor.nationalIdNumber.trim(),
    p_guarantor_id_type:       guarantor.nationalIdType,
    p_guarantor_doc_url:       paths.guarantorDoc,
  });

  onProgress?.(100);

  if (rpcError) {
    if (__DEV__) {
      console.warn('[KYC] RPC submit_kyc_package error:', rpcError.message);
    }
    logKycAudit(userId, 'kyc_submission_failed', {
      submission_id: submissionId,
      stage: 'rpc',
    });
    return {
      error: new Error(
        'Could not submit your KYC application. Please try again or contact support.',
      ),
    };
  }

  const result = data as {
    success?: boolean;
    error?: string;
    application_id?: string;
    status?: string;
  } | null;
  if (result?.error) {
    if (__DEV__) {
      console.warn('[KYC] RPC returned application error:', result.error);
    }
    logKycAudit(userId, 'kyc_submission_failed', {
      submission_id: submissionId,
      stage: 'rpc_result',
    });
    return {
      error: new Error(
        'Could not submit your KYC application. Please try again or contact support.',
      ),
    };
  }

  if (!result?.application_id) {
    logKycAudit(userId, 'kyc_submission_failed', {
      submission_id: submissionId,
      stage: 'missing_application_id',
    });
    return {
      error: new Error(
        'Could not submit your KYC application. Please try again or contact support.',
      ),
    };
  }

  const validation = await requestBackendKycValidation({
    userId,
    submissionId,
    applicationId: result.application_id,
  });

  if (validation.action === 'retake_required') {
    logKycAudit(userId, 'kyc_selfie_retake_required', {
      submission_id: submissionId,
      application_id: result.application_id,
    });
    return {
      error: new Error(
        'Please retake your selfie in a bright place with your full face inside the guide.',
      ),
    };
  }

  logKycAudit(userId, 'kyc_submission_completed', { submission_id: submissionId });
  return { error: null };
}

export async function uploadAvatar(uri: string): Promise<{ path: string | null; error: Error | null }> {
  // user_id derived from the authenticated session — never accepted from caller.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { path: null, error: new Error('Not authenticated') };

  const storagePath = `${user.id}/avatar.jpg`;
  const { error } = await uploadFromUri('avatars', storagePath, uri);
  if (error) return { path: null, error };

  const { data } = supabase.storage.from('avatars').getPublicUrl(storagePath);
  const publicUrl = data.publicUrl;

  // avatar_url is not a protected field; RLS still enforces id = auth.uid().
  const { error: upError } = await supabase
    .from('profiles')
    .update({ avatar_url: publicUrl })
    .eq('id', user.id);
  if (upError) return { path: null, error: new Error(upError.message) };

  return { path: publicUrl, error: null };
}

export async function upsertBasicProfile(params: {
  userId:       string;
  email?:       string;
  phone?:       string;
  firstName?:   string;
  lastName?:    string;
  /** Free-text home address (maps to address_line1 via the RPC). */
  address?:     string;
  /** ISO date string YYYY-MM-DD */
  dateOfBirth?: string;
}): Promise<{ error: Error | null }> {
  // Client-side sanitisation — first line of defence; RPC re-validates server-side.
  const firstName    = params.firstName?.trim()        || null;
  const lastName     = params.lastName?.trim()         || null;
  const email        = params.email?.trim().toLowerCase() || null;
  const addressLine1 = params.address?.trim()          || null;

  // Normalise and validate Sierra Leone phone before sending to RPC.
  // A bad phone here gives a clear, immediate error without a round trip.
  let phone: string | null = null;
  if (params.phone && params.phone.trim()) {
    const normalized = normalizeToSierraLeone(params.phone);
    if (!isValidSierraLeonePhone(normalized)) {
      return {
        error: new Error('Enter a valid Sierra Leone phone number — 8 digits after +232.'),
      };
    }
    phone = normalized;
  }

  // Validate ISO date format before sending; RPC accepts a date type.
  const dob = params.dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(params.dateOfBirth)
    ? params.dateOfBirth
    : null;

  // Use the SECURITY DEFINER RPC — never writes directly to the profiles table.
  // The RPC enforces: auth.uid() ownership, phone format, and immutable-field protection.
  const { data, error: rpcError } = await supabase.rpc('upsert_basic_profile', {
    p_email:      email,
    p_phone:      phone,
    p_first_name: firstName,
    p_last_name:  lastName,
    p_address:    addressLine1,
    p_dob:        dob,
  });

  if (rpcError) return { error: new Error(rpcError.message) };

  const result = data as { success?: boolean; error?: string } | null;
  if (result?.error) return { error: new Error(result.error) };

  return { error: null };
}

export async function logLegalAcceptance(params: {
  userId: string;
  // acceptedAt is intentionally NOT accepted from the caller — the server
  // generates the timestamp via now() inside the SECURITY DEFINER RPC.
  // This prevents clients from supplying back-dated or fabricated acceptance times.
}): Promise<{ error: Error | null }> {
  // log_legal_acceptance is a SECURITY DEFINER function that:
  //  - derives user_id from auth.uid() (never trusted from client)
  //  - sets accepted_at = now() server-side
  //  - stores terms_version and privacy_version from environment/DB config
  //  - inserts into legal_acceptances (RLS: INSERT via RPC only)
  const { error } = await supabase.rpc('log_legal_acceptance', {
    p_terms_version:   '2024-11-01',
    p_privacy_version: '2024-11-01',
  });

  if (error) return { error: new Error(error.message) };
  return { error: null };
}
