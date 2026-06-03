import { create } from 'zustand';

export type Gender = 'male' | 'female' | 'other' | '';

export interface KycDraftState {
  // ── Photo URIs (display only) ──────────────────────────────
  idFrontUri: string | null;
  idBackUri: string | null;
  selfieUri: string | null;

  // ── Photo base64 data (for upload — cleared after submission) ──
  // Stored alongside URIs so upload works for both content:// and
  // file:// URIs without needing expo-file-system.
  idFrontBase64: string | null;
  idBackBase64: string | null;
  selfieBase64: string | null;

  // ── MIME types (detected at pick time) ────────────────────
  idFrontMime: string;   // 'image/jpeg' | 'image/png'
  idBackMime: string;
  selfieMime: string;

  // ── Personal details ───────────────────────────────────────
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  gender: Gender;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  countryId: string | null;
  nationalIdType: string;
  nationalIdNumber: string;
}

const initialDraft: KycDraftState = {
  idFrontUri: null,
  idBackUri: null,
  selfieUri: null,
  idFrontBase64: null,
  idBackBase64: null,
  selfieBase64: null,
  idFrontMime: 'image/jpeg',
  idBackMime: 'image/jpeg',
  selfieMime: 'image/jpeg',
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  dateOfBirth: '',
  gender: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  stateProvince: '',
  postalCode: '',
  countryId: null,
  nationalIdType: '',
  nationalIdNumber: '',
};

interface KycDraftStore extends KycDraftState {
  setDraft: (partial: Partial<KycDraftState>) => void;
  reset: () => void;
}

export const useKycDraftStore = create<KycDraftStore>((set) => ({
  ...initialDraft,
  setDraft: (partial) => set((s) => ({ ...s, ...partial })),
  reset: () => set({ ...initialDraft }),
}));

/** Plain data snapshot for API submission (excludes store actions). */
export function getKycDraftSnapshot(): KycDraftState {
  const s = useKycDraftStore.getState();
  return {
    idFrontUri:    s.idFrontUri,
    idBackUri:     s.idBackUri,
    selfieUri:     s.selfieUri,
    idFrontBase64: s.idFrontBase64,
    idBackBase64:  s.idBackBase64,
    selfieBase64:  s.selfieBase64,
    idFrontMime:   s.idFrontMime,
    idBackMime:    s.idBackMime,
    selfieMime:    s.selfieMime,
    firstName:     s.firstName,
    lastName:      s.lastName,
    phone:         s.phone,
    email:         s.email,
    dateOfBirth:   s.dateOfBirth,
    gender:        s.gender,
    addressLine1:  s.addressLine1,
    addressLine2:  s.addressLine2,
    city:          s.city,
    stateProvince: s.stateProvince,
    postalCode:    s.postalCode,
    countryId:     s.countryId,
    nationalIdType:   s.nationalIdType,
    nationalIdNumber: s.nationalIdNumber,
  };
}
