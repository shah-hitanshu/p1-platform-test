export function GlobeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden {...props}>
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <circle cx="8" cy="8" r="5.75" />
        <path d="M2.6 6.1h10.8M2.6 9.9h10.8" />
        <ellipse cx="8" cy="8" rx="2.6" ry="5.75" />
      </g>
    </svg>
  );
}
