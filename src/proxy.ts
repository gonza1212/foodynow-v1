import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const url = request.nextUrl
  // Obtenemos el host de la petición (ej. mitienda.local:3000)
  let host = request.headers.get('host') || ''

  // Eliminamos el puerto (':3000') para quedarnos solo con el dominio base
  // Esto es crucial para que la lógica de abajo funcione sin problemas.
  host = host.split(':')[0]

  // 1. Ignoramos las rutas internas de Next.js y archivos estáticos.
  if (
    url.pathname.startsWith('/_next') ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/favicon.ico') ||
    url.pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // 2. Lista de subdominios reservados del sistema.
  const reservedSubdomains = ['www', 'app', 'admin', 'dashboard', 'api']

  // 3. Identificamos los dominios raíz para no aplicarle la lógica de tienda.
  //    Si estamos en localhost, local, o el dominio principal, no hacemos nada.
  const isRootDomain = host === 'localhost:3000' || host === 'localhost' || host.endsWith('.local') === false

  // 4. Extraemos el subdominio de forma dinámica.
  //    Por ejemplo, para "mitienda.local", todo lo que está antes del primer punto es el subdominio.
  let subdomain: string | null = null
  const parts = host.split('.')
  if (parts.length >= 2 && !isRootDomain) {
    // El primer segmento es nuestro subdominio/slug
    subdomain = parts[0]
  }

  // 5. Si tenemos un subdominio y no está en la lista de reservados...
  if (subdomain && !reservedSubdomains.includes(subdomain)) {
    // ...lo reescribimos internamente a la ruta dinámica /store/[slug]
    const newUrl = new URL(`/store/${subdomain}`, request.url)
    newUrl.search = url.search
    return NextResponse.rewrite(newUrl)
  }

  // 6. Si no hay subdominio o es uno reservado, el request sigue su curso normal.
  return NextResponse.next()
}