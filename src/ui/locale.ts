// Where node views get the locale for number display (§10.3). There is no user-configurable
// locale setting yet — that lands with the rest of P7 polish — so this is the single call site
// every node view goes through today, kept separate from ui/tokens.ts so swapping it for a
// stored document/user preference later touches one file, not five.
export function getDeviceLocale(): string {
  return Intl.NumberFormat().resolvedOptions().locale;
}
