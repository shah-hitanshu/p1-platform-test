import { NextResponse, type NextRequest } from 'next/server';
import { configuredCredentials, isAuthorized } from './lib/basic-auth';

export function proxy(request: NextRequest) {
  const credentials = configuredCredentials();
  if (!credentials) return NextResponse.next();

  if (!isAuthorized(request.headers.get('authorization'), credentials)) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="P1 Components", charset="UTF-8"',
        'Cache-Control': 'no-store',
      },
    });
  }

  // Catalog pages are served with a year-long s-maxage. Without this the CDN
  // would cache one authenticated response and replay it to everyone.
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

// A proxy always runs on Node, so the credentials are read per request rather
// than snapshotted into the build output. Declaring the runtime here is refused.
export const config = {
  // Everything except the registry JSON under /r, which shadcn fetches without
  // credentials, and Next's own static assets.
  matcher: ['/((?!r/|_next/static|_next/image|favicon.ico).*)'],
};
