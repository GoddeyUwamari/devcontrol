import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware for Route Protection
 */
export function middleware(request: NextRequest) {
  // Ignore Next.js internal prefetch requests
  if (request.headers.get('purpose') === 'prefetch' ||
      request.headers.get('next-router-prefetch') === '1') {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl;

  // Log EVERY request to verify middleware is running

  // Get the auth-token cookie
  const authCookie = request.cookies.get('auth-token')?.value;

  // Log auth status
  if (authCookie) {
  }

  // List all cookies for debugging
  const allCookies = request.cookies.getAll();

  const isAuthenticated = !!authCookie;

  // RULE 1: Authenticated users on / should go to /dashboard
  if (pathname === '/' && isAuthenticated) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // RULE 2: Authenticated users on /login should go to /dashboard
  if ((pathname === '/login' || pathname === '/signup') && isAuthenticated) {
    // Verify token is not a stale/empty value before redirecting
    if (authCookie && authCookie.length > 20) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // RULE 3: Unauthenticated users on protected routes should go to /login
  const protectedRoutes = ['/dashboard', '/services/new', '/infrastructure', '/settings', '/profile'];
  const isProtected = protectedRoutes.some(route =>
    pathname === route || pathname.startsWith(route + '/')
  );

  if (isProtected && !isAuthenticated) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'
  ]
};
