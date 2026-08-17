/**
 * Shown when the content backend could not be reached, as distinct from a path
 * with no page. A published page must not 404 because of a backend blip — that
 * would deindex live content — so this renders a 200 holding page instead, on a
 * render the SDK has already made uncacheable via connection().
 */

export function ContentUnavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          This page is temporarily unavailable
        </h1>
        <p className="mt-4 text-gray-600">
          We couldn&apos;t load this content just now. Please try again in a
          moment.
        </p>
      </div>
    </main>
  );
}
