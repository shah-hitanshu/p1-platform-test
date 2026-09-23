'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function SiteNav() {
  const pathname = usePathname();
  const onBlocks = pathname === '/blocks' || pathname.startsWith('/blocks/');
  const onDocs = pathname === '/documentation';

  return (
    <nav className="p1-header__nav">
      <Link href="/blocks" data-active={onBlocks ? 'true' : undefined}>
        Blocks
      </Link>
      <Link href="/documentation" data-active={onDocs ? 'true' : undefined}>
        Documentation
      </Link>
    </nav>
  );
}
