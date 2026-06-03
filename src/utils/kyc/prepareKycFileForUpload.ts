/**
 * KYC File Preparation Utility
 *
 * Validates and normalises a file selected via expo-image-picker
 * (or expo-camera) before uploading to Supabase Storage.
 *
 * Design decisions:
 *  - Requires base64 data from the picker (base64:true option).
 *    This bypasses the XHR limitation for Android content:// URIs.
 *  - Does NOT use expo-file-system (not installed in this project).
 *  - All validation errors return a plain user-friendly message.
 */

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** 5 MB */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// ── Result types ─────────────────────────────────────────────────────────────

export interface PreparedKycFile {
  /** Local URI for Image display only. */
  uri: string;
  /** Raw base64 string (no data: prefix). Used for upload. */
  base64: string;
  mimeType: AllowedMimeType;
  /** File extension without dot: 'jpg' | 'png' | 'pdf' */
  extension: string;
  /** Approximate size in bytes (from fileSize or estimated from base64). */
  sizeBytes: number;
}

export interface PrepareKycFileError {
  userMessage: string;
}

export type PrepareKycFileResult = PreparedKycFile | PrepareKycFileError;

export function isPrepareError(r: PrepareKycFileResult): r is PrepareKycFileError {
  return 'userMessage' in r;
}

// ── Input type ───────────────────────────────────────────────────────────────

/**
 * Accepts both ImagePickerAsset (expo-image-picker) and
 * CameraCapturedPicture (expo-camera), plus a minimal plain object.
 */
export interface KycFileInput {
  uri: string;
  /** Base64-encoded data WITHOUT the "data:mime;base64," prefix. */
  base64?: string | null;
  /** MIME type if known from the picker (e.g. 'image/jpeg'). */
  mimeType?: string | null;
  /** File name if provided (used for extension inference). */
  fileName?: string | null;
  /** Byte size if known. */
  fileSize?: number | null;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Validates and prepares a KYC file for upload.
 *
 * Usage:
 *   const result = await ImagePicker.launchImageLibraryAsync({ base64: true });
 *   const prepared = prepareKycFileForUpload(result.assets[0]);
 *   if (isPrepareError(prepared)) { Alert.alert(prepared.userMessage); return; }
 *   // prepared.base64 → safe to upload
 */
export function prepareKycFileForUpload(file: KycFileInput): PrepareKycFileResult {
  // 1. URI must exist
  if (!file.uri || file.uri.trim() === '') {
    return { userMessage: 'No file selected. Please choose a photo or document.' };
  }

  // 2. base64 must be present (picked with base64: true)
  if (!file.base64 || file.base64.trim() === '') {
    return {
      userMessage:
        'Could not read file data. Please try picking the file again.\n' +
        'Tip: if you see this repeatedly, restart the app and try once more.',
    };
  }

  // 3. Strip any accidental data-URI prefix
  const base64 = file.base64.replace(/^data:[^;]+;base64,/, '');

  // 4. Detect MIME type
  const mimeType = detectMime(file);
  if (!mimeType) {
    return {
      userMessage:
        'Could not detect file type. Please select a JPEG image, PNG image, or PDF.',
    };
  }

  // 5. Enforce allowed types
  if (!(ALLOWED_MIME_TYPES as ReadonlyArray<string>).includes(mimeType)) {
    return {
      userMessage: `File type not supported (${mimeType}). Please use a JPEG, PNG, or PDF.`,
    };
  }

  // 6. File size check
  const sizeBytes = file.fileSize ?? estimateBytesFromBase64(base64);
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
    return {
      userMessage: `File is too large (${mb} MB). The maximum allowed size is 5 MB. Please compress the image or choose a smaller file.`,
    };
  }

  // 7. Extension
  const extension = mimeToExtension(mimeType as AllowedMimeType);

  return {
    uri:       file.uri,
    base64,
    mimeType:  mimeType as AllowedMimeType,
    extension,
    sizeBytes,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectMime(file: KycFileInput): string | null {
  // Prefer explicit MIME from picker (most reliable)
  if (file.mimeType && file.mimeType.includes('/')) {
    return file.mimeType.toLowerCase();
  }

  // Try file name extension
  const ext = extractExtension(file.fileName ?? file.uri);
  if (ext) {
    const map: Record<string, string> = {
      jpg:  'image/jpeg',
      jpeg: 'image/jpeg',
      png:  'image/png',
      pdf:  'application/pdf',
      webp: 'image/webp',
    };
    if (map[ext]) return map[ext];
  }

  // Try base64 magic bytes
  if (file.base64) {
    const magic = magicFromBase64(file.base64.substring(0, 16));
    if (magic) return magic;
  }

  // Camera always produces JPEG
  if (file.uri.startsWith('file://') && !file.fileName && !file.mimeType) {
    return 'image/jpeg';
  }

  return null;
}

function extractExtension(uriOrName: string): string | null {
  const parts = uriOrName.split('?')[0].split('.');
  if (parts.length < 2) return null;
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Read magic bytes from the beginning of a base64 string to identify
 * the file type without needing to decode the whole payload.
 */
function magicFromBase64(prefix: string): string | null {
  try {
    // JPEG: starts with /9j/
    if (prefix.startsWith('/9j/') || prefix.startsWith('/9g/')) return 'image/jpeg';
    // PNG: starts with iVBORw
    if (prefix.startsWith('iVBOR')) return 'image/png';
    // PDF: starts with JVBERi (= %PDF-)
    if (prefix.startsWith('JVBER')) return 'application/pdf';
  } catch {
    // Ignore
  }
  return null;
}

function mimeToExtension(mime: AllowedMimeType): string {
  switch (mime) {
    case 'image/jpeg':       return 'jpg';
    case 'image/png':        return 'png';
    case 'application/pdf':  return 'pdf';
  }
}

/**
 * Estimate raw byte count from base64 length.
 * base64 encodes 3 bytes as 4 chars; account for padding.
 */
function estimateBytesFromBase64(base64: string): number {
  const padding = (base64.match(/=+$/) ?? [''])[0].length;
  return Math.floor((base64.length * 3) / 4) - padding;
}
