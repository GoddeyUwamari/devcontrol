export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  try {
    const { pathname } = request.nextUrl;
    const authCookie = request.cookies.get('auth-token')?.value;
    const isAuthenticated = !!(authCookie && authCookie.length > 20);

    if (pathname === '/' && isAuthenticated) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    if ((pathname === '/login' || pathname === '/signup') && isAuthenticated) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    const protectedRoutes = ['/dashboard', '/services', '/infrastructure', '/settings', '/profile', '/costs', '/security'];
    const isProtected = protectedRoutes.some(route =>
      pathname === route || pathname.startsWith(route + '/')
    );

    if (isProtected && !isAuthenticated) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    return NextResponse.next();
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)']
};
