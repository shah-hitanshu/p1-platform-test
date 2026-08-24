import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'P1 Block Registry',
  description: 'Puck block components for Pantheon Content Publisher.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="p1-shell">
          <header className="p1-header">
            <Link href="/" className="p1-header__brand">
              P1 Blocks
            </Link>
            <nav className="p1-header__nav">
              <Link href="/">Catalog</Link>
              <Link href="/theme">Tokens</Link>
            </nav>
          </header>
          <main className="p1-main">{children}</main>
          <footer className="p1-footer">
            Pantheon Content Publisher · P1 block registry
          </footer>
        </div>
      </body>
    </html>
  );
}
