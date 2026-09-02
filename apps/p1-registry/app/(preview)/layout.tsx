// Static import so the route owns this CSS and Next emits a <link> for it.
// Reaching block CSS only through the dynamic import chunk leaves the
// prerendered markup unstyled until JS injects it. Pulls in the design tokens,
// shared block chrome, and every block's stylesheet.
import '@pantheon-systems/p1-starter-components/registry/p1/tokens/preview.css';

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          body { margin: 0; padding: 0; background: #fff; font-family: system-ui, sans-serif; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
