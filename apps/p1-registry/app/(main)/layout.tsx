import type { Metadata } from 'next';
import { Inter, Inter_Tight } from 'next/font/google';
import Link from 'next/link';
import { P1_ASSETS } from '@/constants/assets';
import { SiteNav } from '@/_components/SiteNav';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font' });
// Headings use Inter Tight/semibold — the design's own type scale (PDS v2:
// "Heading — Inter Tight, semibold"), not the Poppins/extrabold pairing this
// app used before the redesign.
const interTight = Inter_Tight({
  subsets: ['latin'],
  weight: ['600'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'P1 Block Library',
  description: 'Puck components for Pantheon P1.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable}`}>
      <body>
        <div className="p1-shell">
          <header className="p1-header">
            <div className="p1-header__inner">
              <Link href="/" className="p1-header__brand">
                <img src={P1_ASSETS.LOGO_URL} alt="P1" className="p1-header__logo" />
              </Link>
              <SiteNav />
            </div>
          </header>
          <main className="p1-main">{children}</main>
          <footer className="p1-footer-group">
            <div className="p1-home-cta">
              <div className="p1-home-cta__inner">
                <div>
                  <h2>Ready to build?</h2>
                  <p>Install the full set, or add components one at a time.</p>
                </div>
                <Link href="/blocks" className="p1-btn p1-btn--brand">
                  Browse blocks
                </Link>
              </div>
            </div>
            <div className="p1-footer">
              <p className="p1-footer__tagline">
                The WebOps platform for Next.js, WordPress and Drupal
              </p>
              <nav className="p1-footer__links">
                <Link href="/theme">Design tokens</Link>
              </nav>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
