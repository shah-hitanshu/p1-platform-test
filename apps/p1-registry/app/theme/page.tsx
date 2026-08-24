import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ThemePanel } from '../../_components/ThemePanel';

export default function ThemePage() {
  const tokensJson = JSON.parse(
    readFileSync(join(process.cwd(), 'public', 'r', 'tokens.json'), 'utf8'),
  ) as { files?: { content: string; target?: string }[] };

  const tokensCss =
    tokensJson.files?.find((f) => f.target === 'app/p1-tokens.css')?.content ?? '';

  return (
    <>
      <div className="p1-catalog-intro">
        <h1>Design tokens</h1>
        <p>
          Install with <code>pnpm dlx shadcn@latest add @p1/tokens</code>. The file lands in{' '}
          <code>app/p1-tokens.css</code> and is yours to modify.
        </p>
      </div>
      <ThemePanel cssText={tokensCss} />
    </>
  );
}
