import type { Components } from "react-markdown";

export const markdownComponents: Components = {
  p: ({ children }) => (
    <p className="m-0 max-w-prose leading-relaxed">{children}</p>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-blue-700 underline decoration-blue-700/40 underline-offset-2 hover:decoration-blue-700"
    >
      {children}
    </a>
  ),
};
