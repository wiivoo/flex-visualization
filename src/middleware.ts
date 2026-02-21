import { NextRequest, NextResponse } from 'next/server'
import { verifySession, getSessionCookieName } from '@/lib/auth'

const PUBLIC_PATHS = ['/login', '/api/auth', '/api/prices', '/api/optimize']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public paths without auth
  if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  // Check for session cookie
  const sessionCookie = request.cookies.get(getSessionCookieName())

  if (!sessionCookie?.value) {
    // No session - redirect to login
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
