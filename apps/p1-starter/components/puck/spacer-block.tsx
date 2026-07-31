export const spacerBlock = {
  label: "Spacer",
  fields: {
    height: { type: "number" as const, label: "Height (px)", min: 8, max: 240, step: 4 },
  },
  defaultProps: {
    height: 48,
  },
  render: ({ height }: { height?: number }) => {
    const px = Math.min(240, Math.max(8, height ?? 48));
    return (
      <div
        aria-hidden
        className="w-full min-h-2 max-h-60 shrink-0"
        style={{ height: px }}
      />
    );
  },
};
