export function DatabaseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden {...props}>
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <ellipse cx="8" cy="4" rx="5" ry="2.1" />
        <path d="M3 4v8c0 1.16 2.24 2.1 5 2.1s5-.94 5-2.1V4" />
        <path d="M3 8c0 1.16 2.24 2.1 5 2.1s5-.94 5-2.1" />
      </g>
    </svg>
  );
}
