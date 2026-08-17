"use client";

/**
 * Shown for a path with no published page. Client-side because it renders from
 * the not-found boundary, which receives no params — usePathname is the only
 * way to point "Edit this page" at the path the visitor actually asked for.
 */

import { usePathname } from "next/navigation";

export function PageMissing() {
  const pathname = usePathname() || "/";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          404 &ndash; This page doesn&apos;t exist yet
        </h1>
        <p className="mt-4 text-gray-600">
          This page hasn&apos;t been created. Use the editor to build it.
        </p>

        <nav className="mt-10 flex flex-col gap-3">
          <a
            href={`/p1${pathname}`}
            className="rounded-lg bg-gray-900 px-5 py-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            Edit this page
          </a>
          <a
            href="/p1"
            className="rounded-lg border border-gray-300 px-5 py-3 text-sm font-medium text-gray-900 hover:bg-gray-100"
          >
            Open the Page Editor
          </a>
          <a
            href={`${process.env.NEXT_PUBLIC_P1_ADMIN_DASHBOARD_URL || "https://content.pantheon.io"}/dashboard/sites`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-300 px-5 py-3 text-sm font-medium text-gray-900 hover:bg-gray-100"
          >
            P1 Dashboard &rarr;
          </a>
        </nav>
      </div>
    </main>
  );
}
