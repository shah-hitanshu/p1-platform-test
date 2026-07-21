import React from 'react';

export function GripHandleIcon(): React.ReactElement {
  return (
    <svg
      width={10}
      height={14}
      viewBox="0 0 10 14"
      fill="none"
      style={{ flexShrink: 0, opacity: 0.35 }}
      aria-hidden="true"
    >
      {[0, 4, 8].map((y) =>
        [0, 4].map((x) => (
          <circle key={`${x}-${y}`} cx={x + 2} cy={y + 3} r={1.2} fill="currentColor" />
        )),
      )}
    </svg>
  );
}
