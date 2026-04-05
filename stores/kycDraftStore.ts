import { create } from 'zustand';

export type Gender = 'male' | 'female' | 'other' | '';

export interface KycDraftState {
  idFrontUri: string | null;
  idBackUri: string | null;
  selfieUri: string | null;
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

/** Plain data object for API submission (excludes store actions). */
export function getKycDraftSnapshot(): KycDraftState {
  const s = useKycDraftStore.getState();
  return {
    idFrontUri: s.idFrontUri,
    idBackUri: s.idBackUri,
    selfieUri: s.selfieUri,
    firstName: s.firstName,
    lastName: s.lastName,
    phone: s.phone,
    email: s.email,
    dateOfBirth: s.dateOfBirth,
    gender: s.gender,
    addressLine1: s.addressLine1,
    addressLine2: s.addressLine2,
    city: s.city,
    stateProvince: s.stateProvince,
    postalCode: s.postalCode,
    countryId: s.countryId,
    nationalIdType: s.nationalIdType,
    nationalIdNumber: s.nationalIdNumber,
  };
}
