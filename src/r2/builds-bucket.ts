import { archiveKey } from "./keys";

// The single seam over R2 (decision §16): build archives, branding assets, and audit anchors all flow
// through here. It NEVER produces a presigned URL — everything is read back through the Worker so the
// /download token gate, logging, and instant revocation always hold.

type PutBody = ReadableStream | ArrayBuffer | ArrayBufferView | string;

/** Stores a build archive and returns the key it was written under. */
export async function putArchive(
  r2: R2Bucket,
  buildNumber: number,
  filename: string,
  body: PutBody,
): Promise<string> {
  const key = archiveKey(buildNumber, filename);
  await r2.put(key, body);
  return key;
}

/** Reads an object's body for streaming through /download or /assets. */
export function getObject(r2: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return r2.get(key);
}

/** Metadata-only existence/size check (the §20 register path asserts size == declared). */
export function headObject(r2: R2Bucket, key: string): Promise<R2Object | null> {
  return r2.head(key);
}

export async function putBranding(
  r2: R2Bucket,
  key: string,
  body: PutBody,
  contentType: string,
): Promise<void> {
  await r2.put(key, body, { httpMetadata: { contentType } });
}

export async function putAuditAnchor(r2: R2Bucket, key: string, json: string): Promise<void> {
  await r2.put(key, json, { httpMetadata: { contentType: "application/json" } });
}
