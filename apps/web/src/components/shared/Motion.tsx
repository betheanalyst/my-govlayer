"use client";

/**
 * Reveal — the product's single motion case (Foundation Standard section 14).
 *
 * Motion here has one job: confirming that a recorded write outcome has
 * appeared. It is a 180ms fade with a 4px rise, expressed in CSS rather than
 * through the installed animation library, because section 14 asks for
 * "lightweight CSS/SVG where appropriate" and pulling an animation runtime onto
 * every write surface for this would cost far more than it explains.
 *
 * `prefers-reduced-motion` support comes from the base layer, which zeroes
 * animation and transition durations for anyone who asks for less. Nothing here
 * animates continuously, and nothing implies protocol activity that did not
 * happen.
 */
export function Reveal({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return <div className={className === undefined ? "reveal" : `reveal ${className}`}>{children}</div>;
}
