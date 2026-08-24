import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  let tokensCss = '';
  try {
    const tokensJson = JSON.parse(
      readFileSync(join(process.cwd(), 'public', 'r', 'tokens.json'), 'utf8'),
    ) as { files?: { content: string; target?: string }[] };
    tokensCss =
      tokensJson.files?.find((f) => f.target === 'app/p1-tokens.css')?.content ?? '';
  } catch {
    // Registry not built yet — blocks render without design tokens
  }

  return (
    <html lang="en">
      <head>
        { }
        <style dangerouslySetInnerHTML={{ __html: tokensCss }} />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          body { margin: 0; padding: 0; background: #fff; font-family: system-ui, sans-serif; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
