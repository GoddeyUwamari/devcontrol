import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  try {
    const { pathname } = request.nextUrl;

    // Get the auth-token cookie
    const authCookie = request.cookies.get('auth-token')?.value;
    const isAuthenticated = !!(authCookie && authCookie.length > 20);

    // Authenticated users on / or /login should go to /dashboard
    if ((pathname === '/' || pathname === '/login' || pathname === '/signup') && isAuthenticated) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    // Unauthenticated users on protected routes should go to /login
    const protectedRoutes = ['/dashboard', '/services/new', '/infrastructure', '/settings', '/profile'];
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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'
  ]
};
