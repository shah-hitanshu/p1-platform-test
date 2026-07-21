"use client";

export function PantheonMark() {
  return (
    <svg
      className="h-7 w-auto block"
      viewBox="0 0 105 230"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <polygon fill="#FFDC28" points="17.8,13.4 35.7,56.4 13,56.4 20.5,75.4 66.6,75.4" />
      <polygon fill="#FFDC28" points="78.4,170.1 70.8,151.2 60.3,151.2 38.3,97.9 28.9,97.9 50.8,151.2 24,151.2 73.6,213.2 55.7,170.1" />
      <path fill="#23232D" d="M84.6,94.3c0.6,0,1.9-0.7,1.9-7.3s-1.3-7.3-1.9-7.3H52.8l6,14.6C58.8,94.3,84.6,94.3,84.6,94.3z" />
      <path fill="#23232D" d="M66.1,111.8l21.3,0c0.6,0,1.9-0.7,1.9-7.3s-1.3-7.3-1.9-7.3l-27.4,0L66.1,111.8z" />
      <path fill="#23232D" d="M84.6,132.2H55.9l6,14.6h22.7c0.6,0,1.9-0.7,1.9-7.3S85.1,132.2,84.6,132.2z" />
      <path fill="#23232D" d="M87.4,114.7H48.7l6,14.6h32.7c0.6,0,1.9-0.7,1.9-7.3S88,114.7,87.4,114.7L87.4,114.7z" />
      <path fill="#23232D" d="M31.1,111.9l-6.8-17.6h15.9l7.4,17.6l15.2-0.1L49.5,79.7H16.5c-2.5,0-3.9,0-5.1,3.8c-1.4,4.5-1.5,13.1-1.5,29.7s0.2,25.2,1.5,29.7c1.1,3.8,2.5,3.8,5.1,3.8l29,0l-14.4-35L31.1,111.9L31.1,111.9z" />
      <path fill="#23232D" d="M91.7,143h-1.2v-0.8h3.4v0.8h-1.2v3.5h-1L91.7,143L91.7,143z M96.3,146.5l-1.1-3.3v3.3h-0.9v-4.3h1.3l1.1,3.3l1.1-3.3H99v4.3h-0.9v-3.3l-1,3.3H96.3L96.3,146.5z" />
    </svg>
  );
}

export function P1Lockup() {
  return (
    <div className="inline-flex items-center gap-2.5 mb-6 px-2 -mx-2 rounded-full">
      <PantheonMark />
      <span className="w-px h-5 bg-gray-200" />
      <span className="font-['Inter_Tight','Inter',system-ui,sans-serif] font-semibold text-[19px] tracking-[0.01em] text-[#1a1a2e] leading-none">
        P1
      </span>
    </div>
  );
}
