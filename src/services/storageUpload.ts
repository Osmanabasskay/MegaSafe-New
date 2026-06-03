/**
 * Supabase Storage upload helpers.
 *
 * Two upload paths:
 *   uploadKycFile   — uses base64 data (avoids XHR + content:// URI issues on Android)
 *   uploadFromUri   — XHR-based (kept for avatars and other public-bucket needs)
 *
 * Why base64 for KYC?
 *   expo-image-picker on Android returns content:// URIs from the gallery.
 *   React Native's XHR cannot read content:// URIs directly (throws onerror).
 *   Using base64: true in the picker sidesteps the filesystem entirely.
 */

import { supabase } from './supabase';

// ── Base64 → binary conversion ────────────────────────────────────────────────

/**
 * Converts a raw base64 string (no data: prefix) to a Uint8Array.
 * Uses the global atob() which is available in React Native (Hermes) via
 * React Native's built-in polyfill since RN 0.65.
 */
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// ── KYC upload (base64 path) ──────────────────────────────────────────────────

export interface KycUploadFile {
  /** Raw base64 string WITHOUT the data: prefix. */
  base64: string;
  /** MIME type: 'image/jpeg' | 'image/png' | 'application/pdf' */
  mimeType: string;
}

/**
 * Upload a KYC document to the private kyc-documents bucket.
 *
 * - Uses base64 data directly (no XHR file read; works for content:// URIs).
 * - Does NOT upsert — returns an error if the path already exists.
 *   This prevents overwriting an already-reviewed submission.
 * - Returns storagePath (NOT a public URL — the bucket is private).
 */
export async function uploadKycFile(
  objectPath: string,
  file: KycUploadFile,
): Promise<{ storagePath: string | null; error: Error | null }> {
  if (!file.base64 || !file.mimeType) {
    return { storagePath: null, error: new Error('File data is missing. Please select the file again.') };
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(file.base64);
  } catch {
    return { storagePath: null, error: new Error('Could not decode file data. Please try again.') };
  }

  const { error: uploadError } = await supabase.storage
    .from('kyc-documents')
    .upload(objectPath, bytes, {
      contentType: file.mimeType,
      upsert: false,   // Do NOT overwrite existing KYC files
    });

  if (uploadError) {
    // If this path already exists (duplicate upload / retry), treat as success
    // so the RPC idempotency check can handle it.
    if (uploadError.message?.includes('already exists')) {
      return { storagePath: objectPath, error: null };
    }
    return { storagePath: null, error: new Error(uploadError.message) };
  }

  return { storagePath: objectPath, error: null };
}

// ── Legacy URI upload (XHR path) ─────────────────────────────────────────────

/**
 * Read a local device URI into a Uint8Array using XMLHttpRequest.
 *
 * NOTE: Works for file:// URIs on both iOS and Android.
 *       Does NOT work for content:// URIs on Android — use uploadKycFile instead.
 */
function readUriAsBytes(uri: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.responseType = 'arraybuffer';

    xhr.onload = () => {
      // iOS local files return status 0; Android returns 200
      if (xhr.status === 0 || xhr.status === 200) {
        resolve(new Uint8Array(xhr.response as ArrayBuffer));
      } else {
        reject(new Error(`Could not read file (HTTP ${xhr.status})`));
      }
    };

    xhr.onerror = () =>
      reject(
        new Error(
          'Could not read local file. On Android, files from the gallery must be ' +
          'selected using the base64 option. Please restart the KYC flow.',
        ),
      );

    xhr.open('GET', uri, true);
    xhr.send();
  });
}

/** Infer MIME type from the URI extension. Defaults to JPEG for camera files. */
function guessContentType(uri: string): string {
  const lower = uri.toLowerCase().split('?')[0];
  if (lower.endsWith('.png'))  return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf'))  return 'application/pdf';
  return 'image/jpeg';
}

/**
 * Upload a local device URI to any Supabase Storage bucket (XHR-based).
 * Kept for avatars (public bucket, always file:// URI on both platforms).
 * Returns publicUrl only for public buckets; returns storagePath for private.
 */
export async function uploadFromUri(
  bucket: string,
  objectPath: string,
  uri: string,
): Promise<{ publicUrl: string | null; error: Error | null }> {
  try {
    const contentType = guessContentType(uri);
    const bytes = await readUriAsBytes(uri);

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(objectPath, bytes, { contentType, upsert: true });

    if (uploadError) {
      return { publicUrl: null, error: new Error(uploadError.message) };
    }

    // Only fetch public URL for public buckets (e.g. avatars)
    const { data: bucketData } = await supabase.storage.getBucket(bucket);
    if (bucketData?.public) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
      return { publicUrl: data.publicUrl ?? null, error: null };
    }

    // Private bucket — return the storage path, not a public URL
    return { publicUrl: objectPath, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed.';
    return { publicUrl: null, error: new Error(message) };
  }
}
