import React from 'react';

export function GenericThumbnailIcon(): React.ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 60 40"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden="true"
    >
      <rect width={60} height={40} fill="#2c3035" />
      <rect x={4} y={6} width={52} height={2.5} fill="rgba(255,255,255,0.14)" rx={1} />
      <rect x={4} y={11} width={40} height={2.5} fill="rgba(255,255,255,0.14)" rx={1} />
      <rect x={4} y={16} width={44} height={2.5} fill="rgba(255,255,255,0.14)" rx={1} />
      <rect x={4} y={21} width={36} height={2.5} fill="rgba(255,255,255,0.14)" rx={1} />
    </svg>
  );
}
