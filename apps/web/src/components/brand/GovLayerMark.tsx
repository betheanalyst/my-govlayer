/**
 * GovLayer mark.
 *
 * Direction (Experience Blueprint section 22): abstract and ownable, monochrome
 * capable, legible at favicon size, recognisable beside the wordmark without
 * explanatory text. The figure is the product's own narrative -- separate rules
 * converging into one decision, with the decision continuing into a record.
 *
 * No courthouse, scales, book, ballot box, or shield motifs.
 */
export function GovLayerMark({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role={title === undefined ? "presentation" : "img"}
      aria-hidden={title === undefined ? true : undefined}
      aria-label={title}
    >
      {title === undefined ? null : <title>{title}</title>}
      <g
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Rules */}
        <path d="M3 7h9" />
        <path d="M3 16h9" />
        <path d="M3 25h9" />
        {/* Convergence into one decision */}
        <path d="M12 7c5 0 5 9 9 9" />
        <path d="M12 25c5 0 5-9 9-9" />
        <path d="M12 16h9" />
        {/* The record continues */}
        <path d="M26 18.5V29" />
      </g>
      <circle cx="26" cy="16" r="3" fill="currentColor" />
    </svg>
  );
}
