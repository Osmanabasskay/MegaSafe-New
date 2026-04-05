import { supabase } from './supabase';
import type { KycDraftState } from '../stores/kycDraftStore';
import { uploadFromUri } from './storageUpload';
import type { GuarantorForm } from './validation/kyc';

export type KycStatus = 'pending' | 'submitted' | 'approved' | 'rejected';

export interface ProfileRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  date_of_birth: string | null;
  gender: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country_id: string | null;
  national_id_number: string | null;
  national_id_type: string | null;
  national_id_front_url: string | null;
  national_id_back_url: string | null;
  selfie_url: string | null;
  kyc_status: KycStatus | null;
  kyc_rejection_reason: string | null;
}

export interface CountryRow {
  id: string;
  name: string;
  code: string;
}

const KYC_BUCKET = 'kyc-documents';

export async function fetchCountries(): Promise<{ data: CountryRow[]; error: Error | null }> {
  const { data, error } = await supabase
    .from('countries')
    .select('id,name,code')
    .eq('is_active', true)
    .order('name');

  if (error) return { data: [], error: new Error(error.message) };
  return { data: (data ?? []) as CountryRow[], error: null };
}

export async function fetchProfile(userId: string): Promise<{
  profile: ProfileRow | null;
  error: Error | null;
}> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();

  if (error) return { profile: null, error: new Error(error.message) };
  return { profile: data as ProfileRow | null, error: null };
}

export async function fetchGuarantorForUser(userId: string): Promise<{
  guarantor: { guarantor_name: string; guarantor_phone: string; relationship: string } | null;
  error: Error | null;
}> {
  const { data, error } = await supabase
    .from('guarantors')
    .select('guarantor_name, guarantor_phone, relationship')
    .eq('member_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { guarantor: null, error: new Error(error.message) };
  return { guarantor: data as { guarantor_name: string; guarantor_phone: string; relationship: string } | null, error: null };
}

/** Uploads KYC assets and updates profile + guarantor. Storage paths are stored in URL columns. */
export async function submitKycPackage(params: {
  userId: string;
  authEmail: string;
  draft: KycDraftState;
  guarantor: GuarantorForm;
  guarantorIdUri: string;
}): Promise<{ error: Error | null }> {
  const { userId, authEmail, draft, guarantor, guarantorIdUri } = params;

  const base = `${userId}`;
  const paths = {
    front: `${base}/national-id-front.jpg`,
    back: `${base}/national-id-back.jpg`,
    selfie: `${base}/selfie.jpg`,
    guarantorDoc: `${base}/guarantor-id.jpg`,
  };

  if (!draft.idFrontUri || !draft.idBackUri || !draft.selfieUri) {
    return { error: new Error('Missing ID or selfie photos.') };
  }

  for (const [key, uri] of [
    ['front', draft.idFrontUri],
    ['back', draft.idBackUri],
    ['selfie', draft.selfieUri],
    ['guarantor', guarantorIdUri],
  ] as const) {
    const path = key === 'guarantor' ? paths.guarantorDoc : paths[key];
    const { error } = await uploadFromUri(KYC_BUCKET, path, uri);
    if (error) return { error };
  }

  const frontPath = paths.front;
  const backPath = paths.back;
  const selfiePath = paths.selfie;
  const guarantorPath = paths.guarantorDoc;

  const profilePayload = {
    id: userId,
    email: authEmail,
    first_name: draft.firstName.trim(),
    last_name: draft.lastName.trim(),
    phone: draft.phone.trim(),
    date_of_birth: draft.dateOfBirth,
    gender: draft.gender,
    address_line1: draft.addressLine1.trim(),
    address_line2: draft.addressLine2.trim() || null,
    city: draft.city.trim(),
    state_province: draft.stateProvince.trim() || null,
    postal_code: draft.postalCode.trim() || null,
    country_id: draft.countryId,
    national_id_number: draft.nationalIdNumber.trim(),
    national_id_type: draft.nationalIdType,
    national_id_front_url: frontPath,
    national_id_back_url: backPath,
    selfie_url: selfiePath,
    kyc_status: 'submitted' as const,
    kyc_rejection_reason: null,
  };

  const { error: profileError } = await supabase.from('profiles').upsert(profilePayload, {
    onConflict: 'id',
  });

  if (profileError) return { error: new Error(profileError.message) };

  await supabase.from('guarantors').delete().eq('member_id', userId);

  const guarantorPayload = {
    member_id: userId,
    guarantor_name: guarantor.guarantorName.trim(),
    guarantor_phone: guarantor.guarantorPhone.trim(),
    guarantor_email: guarantor.guarantorEmail?.trim() || null,
    guarantor_address: guarantor.guarantorAddress.trim(),
    relationship: guarantor.relationship.trim(),
    national_id_number: guarantor.nationalIdNumber.trim(),
    national_id_type: guarantor.nationalIdType,
    id_document_url: guarantorPath,
  };

  const { error: gError } = await supabase.from('guarantors').insert(guarantorPayload);
  if (gError) return { error: new Error(gError.message) };

  return { error: null };
}

export async function uploadAvatar(userId: string, uri: string): Promise<{ path: string | null; error: Error | null }> {
  const path = `${userId}/avatar.jpg`;
  const { error } = await uploadFromUri('avatars', path, uri);
  if (error) return { path: null, error };

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const publicUrl = data.publicUrl;

  const { error: upError } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
  if (upError) return { path: null, error: new Error(upError.message) };

  return { path: publicUrl, error: null };
}
