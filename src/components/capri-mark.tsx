export function CapriMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <circle cx="20" cy="17" r="9" className="fill-primary" />
      <path
        d="M4 26c4 0 4-3 8-3s4 3 8 3 4-3 8-3 4 3 8 3"
        className="stroke-foreground"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M8 32c3 0 3-2.5 6-2.5s3 2.5 6 2.5 3-2.5 6-2.5 3 2.5 6 2.5"
        className="stroke-muted-foreground"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
