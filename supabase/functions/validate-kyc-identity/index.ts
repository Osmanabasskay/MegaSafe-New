/**
 * validate-kyc-identity Edge Function
 *
 * Runs backend-only AI-assisted identity validation after submit_kyc_package:
 *   1. OCR NIN extraction from the uploaded ID card.
 *   2. Exact comparison with the user-entered NIN.
 *   3. Selfie quality checks: brightness, sharpness, face position, visibility.
 *   4. Face match between selfie and the ID-card portrait.
 *   5. Securely records audit events and final backend routing decision.
 *
 * The frontend receives only a coarse action. It never receives extracted NINs,
 * confidence scores, thresholds, internal flags, or fraud rules.
 */

import { corsHeaders, handleCors, readBoundedBody } from '../_shared/cors.ts';
import { createServiceClient, getAuthUser } from '../_shared/auth.ts';

interface RequestBody {
  application_id: string;
}

type Decision = 'passed' | 'manual_review' | 'retake_required' | 'failed' | 'error';
type CheckStatus = 'passed' | 'failed' | 'manual_review' | 'retake_required' | 'error';

interface CheckRecord {
  check_type: 'ocr_nin' | 'selfie_quality' | 'face_landmarks' | 'face_match' | 'decision';
  status: CheckStatus;
  reason_code?: string;
  score?: number;
  threshold?: number;
  metadata?: Record<string, unknown>;
}

interface OcrResult {
  extracted_nin: string | null;
  provider_request_id?: string | null;
}

interface SelfieQualityResult {
  brightness: number;
  sharpness: number;
  face_centered: boolean;
  face_inside_frame: boolean;
  obstruction_detected: boolean;
  cropped: boolean;
  landmarks: {
    eyes: boolean;
    nose: boolean;
    mouth: boolean;
    ears: boolean;
  };
  provider_request_id?: string | null;
}

interface FaceMatchResult {
  match: boolean;
  confidence: number;
  provider_request_id?: string | null;
}

const PROVIDER_NAME = Deno.env.get('KYC_AI_PROVIDER')?.trim() || 'external_kyc_ai';
const OCR_ENDPOINT = Deno.env.get('KYC_OCR_ENDPOINT')?.trim() ?? '';
const OCR_API_KEY = Deno.env.get('KYC_OCR_API_KEY')?.trim() ?? '';
const FACE_ENDPOINT = Deno.env.get('KYC_FACE_ENDPOINT')?.trim() ?? '';
const FACE_API_KEY = Deno.env.get('KYC_FACE_API_KEY')?.trim() ?? '';

const MIN_BRIGHTNESS = envNumber('KYC_MIN_BRIGHTNESS', 0.55);
const MIN_SHARPNESS = envNumber('KYC_MIN_SHARPNESS', 0.6);
const FACE_MATCH_THRESHOLD = envNumber('KYC_FACE_MATCH_THRESHOLD', 0.92);

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') return err('Method not allowed.', 405);

  const user = await getAuthUser(req.headers.get('Authorization'));
  if (!user) return err('Not authenticated.', 401);

  const { text: rawBody, error: sizeErr } = await readBoundedBody(req, 2048);
  if (sizeErr) return err(sizeErr, 413);

  let body: RequestBody;
  try {
    body = JSON.parse(rawBody) as RequestBody;
  } catch {
    return err('Invalid JSON body.', 400);
  }

  if (!isUuid(body.application_id)) return err('Invalid KYC application.', 400);

  const svc = createServiceClient();
  const requestId = crypto.randomUUID();

  const { data: app, error: appErr } = await svc
    .from('kyc_applications')
    .select('id,user_id,national_id_number,status')
    .eq('id', body.application_id)
    .maybeSingle();

  if (appErr) {
    console.error('[validate-kyc-identity] application lookup failed:', appErr.message);
    return err('Could not validate KYC at this time.', 500);
  }
  if (!app || app.user_id !== user.id) return err('KYC application not found.', 404);

  await svc.rpc('mark_kyc_ai_processing', {
    p_application_id: body.application_id,
    p_provider: PROVIDER_NAME,
    p_request_id: requestId,
  });

  const { data: docs, error: docsErr } = await svc
    .from('kyc_documents')
    .select('document_kind,storage_path')
    .eq('application_id', body.application_id);

  if (docsErr) {
    console.error('[validate-kyc-identity] document lookup failed:', docsErr.message);
    await finalize(svc, body.application_id, 'manual_review', 'document_lookup_failed', ['document_lookup_failed'], requestId, []);
    return ok({ action: 'manual_review' });
  }

  const docMap = new Map<string, string>();
  for (const d of docs ?? []) docMap.set(String(d.document_kind), String(d.storage_path));

  const idFrontPath = docMap.get('id_front');
  const selfiePath = docMap.get('selfie');
  if (!idFrontPath || !selfiePath) {
    await finalize(svc, body.application_id, 'manual_review', 'missing_required_documents', ['missing_required_documents'], requestId, []);
    return ok({ action: 'manual_review' });
  }

  if (!OCR_ENDPOINT || !OCR_API_KEY || !FACE_ENDPOINT || !FACE_API_KEY) {
    console.error('[validate-kyc-identity] provider secrets/endpoints are not fully configured.');
    await finalize(svc, body.application_id, 'manual_review', 'provider_unconfigured', ['provider_unconfigured'], requestId, []);
    return ok({ action: 'manual_review' });
  }

  const checks: CheckRecord[] = [];
  const flags: string[] = [];

  try {
    const [idFrontUrl, selfieUrl] = await Promise.all([
      signedUrl(svc, idFrontPath),
      signedUrl(svc, selfiePath),
    ]);

    await audit(svc, body.application_id, user.id, 'ocr_started', 'info', undefined, { request_id: requestId });
    const ocr = parseOcrResult(await callOcr(idFrontUrl, requestId));
    await audit(svc, body.application_id, user.id, 'ocr_completed', 'success', undefined, {
      provider_request_id: ocr.provider_request_id ?? null,
    });

    const enteredNin = String(app.national_id_number ?? '').trim();
    const extractedNin = String(ocr.extracted_nin ?? '').trim();
    const ninMatches = extractedNin.length > 0 && extractedNin === enteredNin;

    checks.push({
      check_type: 'ocr_nin',
      status: ninMatches ? 'passed' : 'manual_review',
      reason_code: ninMatches ? 'nin_exact_match' : 'nin_exact_mismatch',
      metadata: { extracted_present: extractedNin.length > 0 },
    });

    await audit(
      svc,
      body.application_id,
      user.id,
      ninMatches ? 'nin_match_passed' : 'nin_match_failed',
      ninMatches ? 'success' : 'warning',
      ninMatches ? 'nin_exact_match' : 'nin_exact_mismatch',
      { extracted_present: extractedNin.length > 0 },
    );

    if (!ninMatches) flags.push('nin_exact_mismatch');

    await audit(svc, body.application_id, user.id, 'selfie_quality_started', 'info', undefined, { request_id: requestId });
    const quality = parseSelfieQualityResult(await callSelfieQuality(selfieUrl, requestId));
    const qualityFailure = evaluateQuality(quality);

    checks.push({
      check_type: 'selfie_quality',
      status: qualityFailure ? 'retake_required' : 'passed',
      reason_code: qualityFailure ?? 'selfie_quality_passed',
      score: quality.sharpness,
      threshold: MIN_SHARPNESS,
      metadata: {
        brightness_ok: numericAtLeast(quality.brightness, MIN_BRIGHTNESS),
        sharpness_ok: numericAtLeast(quality.sharpness, MIN_SHARPNESS),
        face_centered: quality.face_centered === true,
        face_inside_frame: quality.face_inside_frame === true,
      },
    });

    const landmarksOk = Boolean(
      quality.landmarks.eyes &&
      quality.landmarks.nose &&
      quality.landmarks.mouth &&
      quality.landmarks.ears
    );

    checks.push({
      check_type: 'face_landmarks',
      status: landmarksOk ? 'passed' : 'retake_required',
      reason_code: landmarksOk ? 'facial_features_visible' : 'facial_features_not_visible',
      metadata: {
        eyes_visible: quality.landmarks.eyes === true,
        nose_visible: quality.landmarks.nose === true,
        mouth_visible: quality.landmarks.mouth === true,
        ears_visible: quality.landmarks.ears === true,
      },
    });

    if (qualityFailure || !landmarksOk) {
      await audit(
        svc,
        body.application_id,
        user.id,
        'selfie_quality_failed',
        'warning',
        qualityFailure ?? 'facial_features_not_visible',
        { provider_request_id: quality.provider_request_id ?? null },
      );
      await finalize(
        svc,
        body.application_id,
        'retake_required',
        qualityFailure ?? 'facial_features_not_visible',
        [qualityFailure ?? 'facial_features_not_visible'],
        requestId,
        checks,
      );
      return ok({ action: 'retake_required' });
    }

    await audit(svc, body.application_id, user.id, 'selfie_quality_passed', 'success', undefined, {
      provider_request_id: quality.provider_request_id ?? null,
    });

    await audit(svc, body.application_id, user.id, 'face_match_started', 'info', undefined, { request_id: requestId });
    const face = parseFaceMatchResult(await callFaceMatch(idFrontUrl, selfieUrl, requestId));
    const facePassed = face.match === true && numericAtLeast(face.confidence, FACE_MATCH_THRESHOLD);

    checks.push({
      check_type: 'face_match',
      status: facePassed ? 'passed' : 'manual_review',
      reason_code: facePassed ? 'face_match_passed' : 'face_match_failed',
      score: face.confidence,
      threshold: FACE_MATCH_THRESHOLD,
      metadata: { provider_match: face.match === true },
    });

    await audit(
      svc,
      body.application_id,
      user.id,
      facePassed ? 'face_match_passed' : 'face_match_failed',
      facePassed ? 'success' : 'warning',
      facePassed ? 'face_match_passed' : 'face_match_failed',
      { provider_request_id: face.provider_request_id ?? null },
    );

    if (!facePassed) flags.push('face_match_failed');

    const decision: Decision = flags.length > 0 ? 'manual_review' : 'passed';
    const reason = flags[0] ?? 'ai_checks_passed';

    checks.push({
      check_type: 'decision',
      status: decision === 'passed' ? 'passed' : 'manual_review',
      reason_code: reason,
      metadata: { flags },
    });

    await finalize(svc, body.application_id, decision, reason, flags, requestId, checks);
    return ok({ action: decision === 'passed' ? 'submitted_for_review' : 'manual_review' });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[validate-kyc-identity] provider validation failed:', message);
    checks.push({
      check_type: 'decision',
      status: 'error',
      reason_code: 'provider_validation_error',
      metadata: { provider: PROVIDER_NAME },
    });
    await finalize(svc, body.application_id, 'manual_review', 'provider_validation_error', ['provider_validation_error'], requestId, checks);
    return ok({ action: 'manual_review' });
  }
});

async function signedUrl(svc: ReturnType<typeof createServiceClient>, path: string): Promise<string> {
  const { data, error } = await svc.storage
    .from('kyc-documents')
    .createSignedUrl(path, 60 * 5);
  if (error || !data?.signedUrl) throw new Error(`Could not create signed URL for ${path}`);
  return data.signedUrl;
}

async function callOcr(idFrontUrl: string, requestId: string): Promise<unknown> {
  const res = await fetch(OCR_ENDPOINT, {
    method: 'POST',
    headers: providerHeaders(OCR_API_KEY, requestId),
    body: JSON.stringify({ document_url: idFrontUrl, document_type: 'national_id', fields: ['nin'] }),
  });
  return parseProviderResponse<OcrResult>(res, 'OCR provider failed');
}

async function callSelfieQuality(selfieUrl: string, requestId: string): Promise<unknown> {
  const res = await fetch(`${FACE_ENDPOINT.replace(/\/$/, '')}/selfie-quality`, {
    method: 'POST',
    headers: providerHeaders(FACE_API_KEY, requestId),
    body: JSON.stringify({
      selfie_url: selfieUrl,
      checks: ['brightness', 'sharpness', 'face_position', 'landmarks', 'obstruction', 'crop'],
    }),
  });
  return parseProviderResponse<SelfieQualityResult>(res, 'Selfie quality provider failed');
}

async function callFaceMatch(idFrontUrl: string, selfieUrl: string, requestId: string): Promise<unknown> {
  const res = await fetch(`${FACE_ENDPOINT.replace(/\/$/, '')}/face-match`, {
    method: 'POST',
    headers: providerHeaders(FACE_API_KEY, requestId),
    body: JSON.stringify({ id_document_url: idFrontUrl, selfie_url: selfieUrl }),
  });
  return parseProviderResponse<FaceMatchResult>(res, 'Face match provider failed');
}

function providerHeaders(apiKey: string, requestId: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'X-Request-ID': requestId,
  };
}

async function parseProviderResponse<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) throw new Error(`${fallback}: HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data || typeof data !== 'object') throw new Error(`${fallback}: malformed response`);
  return data as T;
}

function parseOcrResult(raw: unknown): OcrResult {
  const data = asRecord(raw, 'OCR provider response');
  const extracted = pickString(data, ['extracted_nin', 'nin', 'id_number', 'national_id_number']);
  const providerRequestId = pickString(data, ['provider_request_id', 'request_id', 'id']);

  if (extracted !== null && !/^[A-Za-z0-9\-\/\s]{3,64}$/.test(extracted)) {
    throw new Error('OCR provider returned invalid NIN format.');
  }

  return {
    extracted_nin: extracted,
    provider_request_id: providerRequestId,
  };
}

function parseSelfieQualityResult(raw: unknown): SelfieQualityResult {
  const data = asRecord(raw, 'Selfie quality provider response');
  const landmarks = asRecord(data.landmarks, 'Selfie landmarks');

  return {
    brightness: requireUnitNumber(data.brightness, 'brightness'),
    sharpness: requireUnitNumber(data.sharpness, 'sharpness'),
    face_centered: requireBoolean(data.face_centered, 'face_centered'),
    face_inside_frame: requireBoolean(data.face_inside_frame, 'face_inside_frame'),
    obstruction_detected: requireBoolean(data.obstruction_detected, 'obstruction_detected'),
    cropped: requireBoolean(data.cropped, 'cropped'),
    landmarks: {
      eyes: requireBoolean(landmarks.eyes, 'landmarks.eyes'),
      nose: requireBoolean(landmarks.nose, 'landmarks.nose'),
      mouth: requireBoolean(landmarks.mouth, 'landmarks.mouth'),
      ears: requireBoolean(landmarks.ears, 'landmarks.ears'),
    },
    provider_request_id: pickString(data, ['provider_request_id', 'request_id', 'id']),
  };
}

function parseFaceMatchResult(raw: unknown): FaceMatchResult {
  const data = asRecord(raw, 'Face match provider response');
  return {
    match: requireBoolean(data.match, 'match'),
    confidence: requireUnitNumber(data.confidence, 'confidence'),
    provider_request_id: pickString(data, ['provider_request_id', 'request_id', 'id']),
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function pickString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Provider field ${label} must be boolean.`);
  return value;
}

function requireUnitNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Provider field ${label} must be a number between 0 and 1.`);
  }
  return value;
}

function evaluateQuality(q: SelfieQualityResult): string | null {
  if (!numericAtLeast(q.brightness, MIN_BRIGHTNESS)) return 'selfie_too_dark';
  if (!numericAtLeast(q.sharpness, MIN_SHARPNESS)) return 'selfie_blurry';
  if (q.face_centered !== true) return 'face_not_centered';
  if (q.face_inside_frame !== true) return 'face_outside_frame';
  if (q.cropped === true) return 'face_cropped';
  if (q.obstruction_detected === true) return 'face_obstructed';
  return null;
}

async function finalize(
  svc: ReturnType<typeof createServiceClient>,
  applicationId: string,
  decision: Decision,
  reasonCode: string,
  flags: string[],
  requestId: string,
  checks: CheckRecord[],
) {
  const { error } = await svc.rpc('finalize_kyc_ai_validation', {
    p_application_id: applicationId,
    p_decision: decision,
    p_reason_code: reasonCode,
    p_flags: flags,
    p_provider: PROVIDER_NAME,
    p_request_id: requestId,
    p_checks: checks,
  });
  if (error) console.error('[validate-kyc-identity] finalize failed:', error.message);
}

async function audit(
  svc: ReturnType<typeof createServiceClient>,
  applicationId: string,
  userId: string,
  eventType: string,
  status: 'success' | 'failed' | 'warning' | 'info',
  reasonCode?: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await svc.rpc('record_kyc_audit_event', {
    p_application_id: applicationId,
    p_user_id: userId,
    p_event_type: eventType,
    p_status: status,
    p_reason_code: reasonCode ?? null,
    p_metadata: metadata,
  });
  if (error) console.error('[validate-kyc-identity] audit failed:', error.message);
}

function envNumber(key: string, fallback: number): number {
  const raw = Deno.env.get(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function numericAtLeast(value: number | undefined, min: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min;
}

function isUuid(value: string | undefined): boolean {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(msg: string, status = 400): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
