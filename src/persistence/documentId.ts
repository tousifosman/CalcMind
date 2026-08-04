// Document-id safety for StorageAdapter path/key construction (§12.2).
//
// Lives in its own module (no `.native` / `.web` twin) so platform adapter files
// can import it without Metro/Jest resolving `./adapter` back onto themselves.
//
// Ids become path segments on native and IndexedDB keys on web. Reject anything
// outside the alphabet `createDocumentId` / nanoid already emit.

const SAFE_DOCUMENT_ID = /^[A-Za-z0-9_-]+$/;

export function isSafeDocumentId(id: string): boolean {
  return id.length > 0 && SAFE_DOCUMENT_ID.test(id);
}

export function assertSafeDocumentId(id: string): void {
  if (!isSafeDocumentId(id)) {
    throw new Error(`persistence: unsafe document id ${JSON.stringify(id)}`);
  }
}
