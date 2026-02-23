import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';



// Route protection middleware

// Since we use localStorage for mock auth (client-side only),

// this middleware handles basic redirects. Full auth check happens client-side.

export function middleware(request: NextRequest) {

  const { pathname } = request.nextUrl;



  // Public routes that don't need auth

  const publicRoutes = ['/login', '/register'];

  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));



  // Static assets and API routes should pass through

  if (

    pathname.startsWith('/_next') ||

    pathname.startsWith('/api') ||

    pathname.includes('.')

  ) {

    return NextResponse.next();

  }



  // For now, allow all routes (mock auth is client-side via localStorage)

  // When real auth is added, check session cookie here

  return NextResponse.next();

}



export const config = {

  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],

};

