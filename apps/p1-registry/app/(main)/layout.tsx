import type { Metadata } from 'next';
import { Inter, Poppins } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font' });
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'P1 Components',
  description: 'Puck components for Pantheon P1.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable}`}>
      <body>
        <div className="p1-shell">
          <header className="p1-header">
            <div className="p1-header__inner">
              <Link href="/" className="p1-header__brand">
                <img src="/p1_logo.svg" alt="P1" className="p1-header__logo" />
                <span className="p1-header__brand-divider" aria-hidden="true" />
                <span className="p1-header__brand-label">Components</span>
              </Link>
              <nav className="p1-header__nav">
                <Link href="/">Catalog</Link>
                <span className="p1-header__nav-divider" aria-hidden="true" />
                <Link href="/theme">Tokens</Link>
              </nav>
            </div>
          </header>
          <main className="p1-main">{children}</main>
          <footer className="p1-footer">
            <span>P1 Components</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
