import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const url = request.nextUrl
  const host = request.headers.get('host') || ''

  // Ignorar rutas internas de Next.js y archivos estáticos
  if (
    url.pathname.startsWith('/_next') ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/favicon.ico') ||
    url.pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // Subdominios reservados (no se tratan como tiendas)
  const reservedSubdomains = ['www', 'app', 'admin', 'dashboard', 'api']

  // Detectar subdominio
  const hostWithoutPort = host.split(':')[0]
  let subdomain: string | null = null

  const parts = hostWithoutPort.split('.')
  if (parts.length >= 2) {
    subdomain = parts[0]
  }

  // Si el subdominio no está reservado, reescribir a /store/[slug]
  if (subdomain && !reservedSubdomains.includes(subdomain)) {
    const newUrl = new URL(`/store/${subdomain}`, url)
    newUrl.search = url.search
    return NextResponse.rewrite(newUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
}