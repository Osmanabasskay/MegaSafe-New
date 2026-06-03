import { z } from 'zod';

export const nationalIdTypes = [
  { value: 'national_id', label: 'National ID' },
  { value: 'passport', label: 'Passport' },
  { value: 'drivers_license', label: "Driver's license" },
  { value: 'voters_card', label: "Voter's card" },
] as const;

export const kycDetailsSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  phone: z.string().trim().min(1, 'Phone is required'),
  dateOfBirth: z
    .string()
    .trim()
    .min(1, 'Date of birth is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  gender: z
    .union([z.literal(''), z.enum(['male', 'female', 'other'])])
    .refine((v) => v !== '', { message: 'Select gender' }),
  addressLine1: z.string().trim().min(1, 'Address is required'),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().min(1, 'City is required'),
  stateProvince: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  countryId: z.string().min(1, 'Select your country').uuid('Select your country'),
  nationalIdType: z.enum(['national_id', 'passport', 'drivers_license', 'voters_card']),
  nationalIdNumber: z.string().trim().min(3, 'ID number is required'),
});

export type KycDetailsForm = z.infer<typeof kycDetailsSchema>;

export const guarantorSchema = z.object({
  guarantorName: z.string().trim().min(1, 'Name is required'),
  guarantorPhone: z.string().trim().min(1, 'Phone is required'),
  guarantorEmail: z.union([z.literal(''), z.string().trim().email()]),
  guarantorAddress: z.string().trim().min(1, 'Address is required'),
  relationship: z.string().trim().min(1, 'Relationship is required'),
  nationalIdType: z.enum(['national_id', 'passport', 'drivers_license', 'voters_card']),
  nationalIdNumber: z.string().trim().min(3, 'ID number is required'),
});

export type GuarantorForm = z.infer<typeof guarantorSchema>;
