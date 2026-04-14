import type { ReactNode } from "react";

export const puckRoot = {
  fields: {
    title: { type: "text" as const },
    description: { type: "textarea" as const },
  },
  defaultProps: {
    title: "My Puck Editor",
  },
  render: (props: { children?: ReactNode; title?: string }) => {
    const { children, title } = props;
    return (
      <div className="font-sans antialiased">
        <h1>{title}</h1>
        {children}
      </div>
    );
  },
};
