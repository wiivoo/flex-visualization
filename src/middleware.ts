import { NextRequest, NextResponse } from 'next/server'
import { verifySession, getSessionCookieName } from '@/lib/auth'

// Exact public paths (no prefix matching to prevent auth bypass on sub-routes)
const PUBLIC_PATHS = new Set(['/login', '/api/auth', '/api/prices', '/api/prices/batch', '/api/optimize', '/api/prices/bulk', '/api/generation'])

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public paths without auth (exact match only)
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  // Check for session cookie
  const sessionCookie = request.cookies.get(getSessionCookieName())

  if (!sessionCookie?.value) {
    // No session - redirect to login, preserving full path + query string
    const loginUrl = new URL('/login', request.url)
    const search = request.nextUrl.search
    loginUrl.searchParams.set('redirect', pathname + search)
    return NextResponse.redirect(loginUrl)
  }

  // Verify session
  try {
    const isValid = await verifySession(sessionCookie.value)
    if (!isValid) {
      // Invalid session - redirect to login
      const loginUrl = new URL('/login', request.url)
      return NextResponse.redirect(loginUrl)
    }
  } catch {
    // Error verifying - redirect to login
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|data/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json)$).*)',
  ],
}
