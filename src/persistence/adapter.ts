// Storage adapter contract. See docs/ARCHITECTURE.md §12.2.
//
// Platform bundlers replace this module: Metro resolves `adapter.native.ts`,
// webpack resolves `adapter.web.ts` (via resolve.extensions). TypeScript has no
// platform resolution under `moduleResolution: "bundler"`, so this file also
// exports a stub `storageAdapter` that matches the platform modules' surface —
// it must never run; a throw here means a bundler failed to pick a platform file.

export interface DocumentMeta {
  id: string;
  name: string;
  updatedAt: string;
  bytes: number;
}

export interface StorageAdapter {
  list(): Promise<DocumentMeta[]>;
  read(id: string): Promise<string>;
  /** Must be atomic (§12.3): crash mid-save leaves the old file or the new one. */
  write(id: string, json: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Optional: OS share sheet (native) or file download (web). */
  exportDocument?(id: string): Promise<void>;
  /** Optional: file picker → raw JSON string. */
  importDocument?(): Promise<string | null>;
}

function unresolved(): never {
  throw new Error(
    'persistence: StorageAdapter platform module was not resolved (expected adapter.native.ts or adapter.web.ts)',
  );
}

/** Stub for tsc; Metro/webpack substitute the platform implementation. */
export const storageAdapter: StorageAdapter = {
  list: unresolved,
  read: unresolved,
  write: unresolved,
  remove: unresolved,
};
