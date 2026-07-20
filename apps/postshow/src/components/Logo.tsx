/** The Postshow mark: a P whose bowl is the ghost light. Stem inherits
 * currentColor so the mark works on both the light shell and night surfaces. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden focusable="false">
      <rect x="6" y="3" width="5.5" height="26" rx="2.75" fill="currentColor" />
      <circle cx="19" cy="11.5" r="8.5" fill="var(--signal)" />
    </svg>
  );
}
