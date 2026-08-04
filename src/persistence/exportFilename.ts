// Friendly `.calcmind.json` filename for export (P5.8). Shared by native and web
// adapters so the two platforms cannot drift on sanitisation rules.
export function filenameForExport(id: string, json: string): string {
  let base = id;
  try {
    const parsed = JSON.parse(json) as { name?: unknown };
    if (typeof parsed.name === 'string' && parsed.name.trim().length > 0) {
      base = parsed.name
        .trim()
        .replace(/[^\w\- ]+/g, '_')
        .replace(/\s+/g, ' ')
        .slice(0, 80);
    }
  } catch {
    // Keep id — export must still work for corrupt-but-readable primaries.
  }
  return `${base}.calcmind.json`;
}
