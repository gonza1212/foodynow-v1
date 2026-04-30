
# Proyecto: FoodyNow — Contexto técnico y de diseño

**Propósito:** Documento maestro para pasar a cualquier IA o desarrollador. Contiene las decisiones de arquitectura, patrones, modelo de datos, UI/UX, y recomendaciones operativas para mantener coherencia en la implementación de la PWA marketplace de comida (Next.js + Supabase / futura migración a Laravel).

---

## 1. Resumen ejecutivo

**Visión corta:** Aplicación PWA multi‑tenant para comercios de comida, optimizada para móviles, con motor de pricing (packs), persistencia local del carrito, theming dinámico por tienda y arquitectura que permita migrar a un backend tradicional (Laravel) cuando sea necesario.

---

## 2. Arquitectura y organización del código

### Estructura de carpetas recomendada
- /foodynow-v1 <-- carpeta raíz del proyecto.
- **/src/app** — Rutas y layouts (Next.js App Router).
- **/src/components/ui** — Componentes atómicos (Shadcn/UI).
- **/src/components/features** — Organismos y vistas por funcionalidad (Cart, ProductGrid, Checkout).
- **/src/services** — *Service Layer*: única capa con llamadas a Supabase / API.
- **/src/domain** — Lógica de negocio pura (pricing, validaciones).
- **/src/hooks** — Hooks (useProducts, useOrders, useAuth).
- **/src/store** — Estado global (Zustand).
- **/src/types** — Tipos TypeScript (generados desde el esquema DB).
- **/src/lib** — Utilidades, configuraciones (cliente Supabase, helpers).

**Regla de oro:** Los componentes visuales **no** deben conocer la fuente de datos; llaman a servicios o hooks.

---

## 3. Modelo de datos (actualizado)

### 3.1. Tablas principales (PostgreSQL)

```sql
-- Perfiles sincronizados con Supabase Auth
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  email text,
  full_name text,
  avatar_url text,
  role text CHECK (role IN ('owner', 'admin', 'customer'))
);

-- Núcleo del Sistema (Multi-tenant & Config)
CREATE TABLE stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES profiles(id) NOT NULL,
  slug text UNIQUE NOT NULL,
  subdomain text UNIQUE,
  name text NOT NULL,
  is_active boolean DEFAULT true,
  theme_config jsonb,
  logo_url text,
  header_image_url text,
  is_onboarded boolean DEFAULT false
);

CREATE TABLE store_settings (
  store_id uuid PRIMARY KEY REFERENCES stores(id),
  whatsapp_number text,
  business_hours jsonb,
  is_open boolean DEFAULT true,
  delivery_fee numeric,
  min_order_amount numeric,
  delivery_radius int,
  welcome_message text,
  order_confirmation_message text
);

-- Catálogo y Motor de Pricing
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES stores(id) NOT NULL,
  name text NOT NULL,
  description text,
  image_url text,
  sort_order int,
  is_active boolean DEFAULT true
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES categories(id),
  store_id uuid REFERENCES stores(id) NOT NULL,
  name text NOT NULL,
  description text,
  base_price numeric NOT NULL,
  sale_price numeric,
  image_url text,
  is_available boolean DEFAULT true,
  sort_order int
);

CREATE TABLE product_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) NOT NULL,
  image_url text NOT NULL,
  sort_order int
);

CREATE TABLE pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) NOT NULL,
  rule_type text CHECK (rule_type IN ('pack', 'unit')),
  min_quantity int NOT NULL,
  pack_price numeric,
  priority int DEFAULT 0
);

CREATE TABLE composition_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) NOT NULL,
  name text NOT NULL,
  min_select int DEFAULT 0,
  max_select int,
  is_required boolean DEFAULT false
);

CREATE TABLE composition_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES composition_groups(id) NOT NULL,
  name text NOT NULL,
  price_modifier numeric DEFAULT 0
);

-- Ventas y Workflow de Pedidos
CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');

CREATE TABLE checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_reference uuid UNIQUE NOT NULL,
  store_id uuid REFERENCES stores(id) NOT NULL,
  items_snapshot jsonb NOT NULL,
  order_data_temp jsonb,
  total numeric NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
  preference_id text,
  expires_at timestamptz DEFAULT (now() + interval '30 minutes')
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES stores(id) NOT NULL,
  checkout_session_id uuid REFERENCES checkout_sessions(id),
  customer_info jsonb NOT NULL, -- {name, phone, email, address, delivery_notes}
  delivery_type text,
  total numeric NOT NULL,
  status order_status DEFAULT 'pending',
  payment_status payment_status DEFAULT 'pending',
  estimated_delivery_time int,
  notes text,
  store_notified_at timestamptz,
  customer_notified_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) NOT NULL,
  product_id uuid REFERENCES products(id) NOT NULL,
  quantity int NOT NULL,
  unit_price numeric NOT NULL,
  pricing_snapshot jsonb -- cómo se aplicaron los packs
);

CREATE TABLE order_item_compositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid REFERENCES order_items(id) NOT NULL,
  name text NOT NULL,
  quantity int,
  price_modifier numeric
);

-- Pagos e Integraciones
CREATE TABLE payment_integrations (
  store_id uuid PRIMARY KEY REFERENCES stores(id),
  provider text NOT NULL,
  mp_user_id text,
  access_token text,
  refresh_token text,
  public_key text,
  status text,
  token_expires_at timestamptz
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) NOT NULL,
  provider_payment_id text NOT NULL,
  status text,
  amount numeric,
  raw_response jsonb
);

-- SaaS, Notificaciones y PWA
CREATE TABLE subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price numeric NOT NULL,
  features jsonb,
  max_products int
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES stores(id) NOT NULL,
  plan_id uuid REFERENCES subscription_plans(id) NOT NULL,
  status text,
  trial_ends_at timestamptz,
  next_billing_date timestamptz
);

CREATE TABLE whatsapp_message_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES stores(id) NOT NULL,
  order_id uuid REFERENCES orders(id),
  recipient_phone text NOT NULL,
  message_content text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  attempts int DEFAULT 0,
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES stores(id) NOT NULL,
  endpoint text NOT NULL,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL
);
```

### 3.2. Índices recomendados para rendimiento

```sql
CREATE INDEX idx_orders_store_status ON orders(store_id, status, created_at);
CREATE INDEX idx_checkout_session_external ON checkout_sessions(external_reference);
CREATE INDEX idx_checkout_session_store ON checkout_sessions(store_id, status);
CREATE INDEX idx_products_store_category ON products(store_id, category_id, is_available);
CREATE INDEX idx_whatsapp_queue_status ON whatsapp_message_queue(status, created_at);
```

---

## 4. Patrones y responsabilidades (principales)

### Service Layer
- **/src/services** centraliza todas las llamadas a la infraestructura (Supabase, MP, WhatsApp).
- Frontend → Hooks → Services → DB/API. Cambiar backend implica editar solo `services/*`.

### Domain Logic
- **/src/domain/pricing.ts**: funciones puras que reciben un cart y devuelven `price_breakdown`.
- Ejecutar la misma lógica en frontend (UX instantánea) y backend (Edge Function o Laravel) para validación.

### Estado y performance
- **Zustand** para carrito persistente (persist middleware).
- **TanStack Query** para fetching, cache y optimistic updates.
- Server Components para contenido estático/SEO; Client Components para interactividad.

### Seguridad
- Row Level Security (RLS) en Postgres/Supabase: políticas por `store_id` y `auth.uid()`.
- Checkout Session pattern: sesión creada con `status: pending` y validada por backend antes de convertir a `orders`.
- **Webhooks de MercadoPago:** validar firma (`x-signature` o token) para evitar creación fraudulenta de órdenes.

### Manejo de errores y logs
- Usar `console.error` en desarrollo; en producción enviar a un servicio como Sentry o guardar en una tabla `error_logs`.
- En `whatsapp_message_queue`, registrar `error_message` cuando `status = 'failed'`.

### Limpieza de sesiones expiradas
- Una Edge Function programada (cron) que borre o marque como `expired` las `checkout_sessions` con `expires_at < now()` y `status = 'pending'`.

### D. Estándar de Impresión (Thermal Printing)
*   **Formato:** Soporte nativo para impresoras de **80mm**.
*   **Implementación:** Uso de `window.open` con documentos HTML inyectados para evitar estilos globales de la App que ensucien el ticket.
*   **CSS Crítico:** 
    *   `@page { size: 80mm auto; margin: 5mm; }`
    *   Uso de fuentes `sans-serif` para máxima legibilidad en impresión térmica.
    *   Layout basado en `flex` para alineación de cantidades, nombres y precios.

---

## 5. UI / Design System (implementación práctica)

### Atomic UI
- Usar **Shadcn/UI** + **Tailwind**; mantener `/components/ui` con tokens y componentes reutilizables.
- Ejemplo: en vistas usar `<Button>Confirmar Pedido</Button>` en lugar de clases inline.

### Theming dinámico
- Guardar `theme_config` en `stores.theme_config` (JSONB).
- Inyectar CSS variables en `layout.tsx`:
```ts
<body style={{
  "--primary": theme.primary,
  "--radius": theme.radius,
  "--background": theme.background
} as React.CSSProperties}>
```
- Configurar `tailwind.config.ts` para usar `var(--primary)` y tokens.

### Skeletons y App Shell
- Implementar `loading.tsx` + Suspense para skeleton screens y evitar layout shift.
- Flujo visual: App Shell (barra, colores) → Skeletons → datos reales.

### Tokens y clases "salvavidas"
- **Card producto:** `bg-surface border border-border rounded-xl p-4 shadow-soft active:scale-[0.98] transition-transform`
- **Botón principal:** `bg-primary text-primary-foreground h-12 px-6 rounded-xl font-bold flex items-center justify-center gap-2`
- **Touch targets:** botones +/- mínimo `w-10 h-10` o `w-12 h-12`
- Tipografía: **Inter** (titulares bold), cuerpo normal, precios con `font-mono` o `font-semibold`.

---

## 6. Flujos críticos y operaciones

### Flujo de compra (alto nivel)
1. **Selección**: UI llama a `PricingService.calculate(cart)` (domain pure function).
2. **Crear sesión**: `CheckoutService.createSession(cart)` — valida precios en servidor, crea `checkout_sessions` con `status: pending`, genera preferencia MP, asigna `expires_at = now() + 30 min`.
3. **Confirmación**: Webhook MP → Edge Function / API → verificar firma → `OrderService.convertToSession(sessionId)` → mueve sesión a `orders` y encola notificaciones (WhatsApp).

### Realtime y operaciones
- **Order Board**: suscripciones Supabase (realtime) para evitar polling.
- **State machine** para pedidos: `pending -> confirmed -> preparing -> ready -> delivered/cancelled`.
- **Colas**: usar `whatsapp_message_queue` y Edge Functions (o Laravel queues cuando se migre).

---

## 7. Migración y estrategia SaaS (Supabase → Laravel)

**Estrategia pragmática**
- **MVP:** arrancar con Supabase para acelerar lanzamiento; mantener la lógica crítica (pricing, validación de checkout) en funciones separadas (Edge Functions o API Routes) para facilitar migración.
- **Trigger para migrar:** cuando haya >10–15 tiendas pagas, o se necesiten jobs/colas complejas y control fino (retries, backoff).
- **DB:** mantener PostgreSQL; diseñar esquema normalizado y con convenciones (tablas en plural, FK claras) para facilitar conexión desde Laravel.

---

## 8. Variables de entorno y configuración

Crear `.env.local` con:

bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=tu_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key

# Mercado Pago
MERCADOPAGO_ACCESS_TOKEN=...
MERCADOPAGO_WEBHOOK_SECRET=...

# WhatsApp (si usas API oficial o Twilio)
WHATSAPP_API_KEY=...
WHATSAPP_API_URL=...

# Opcional: logging
SENTRY_DSN=...

---

## 9. PWA y offline

- Configurar `next-pwa` con estrategia `stale-while-revalidate` para productos.
- El Service Worker debe cachear el App Shell y los assets críticos.
- **Background sync:** cuando el dispositivo recupera conexión, sincronizar acciones pendientes (ej. reintentar envío de un pedido).
- El carrito (Zustand + persist) funciona offline; al reconectar, validar precios con el backend.

---

## 10. Recomendaciones prácticas y checklist para desarrolladores / IA

### Al crear componentes
- **Siempre** usar componentes atómicos del UI Kit.
- Evitar clases Tailwind inline repetidas; encapsular estilos en componentes.
- Preferir **slots / render props** para variantes similares.

### Al implementar lógica de precios
- Implementar **funciones puras** en `/src/domain/pricing.ts`.
- Escribir tests unitarios exhaustivos (combinaciones de packs, descuentos, composiciones).
- Guardar `pricing_snapshot` en `order_items` al crear la orden.

### Al integrar pagos
- Usar `external_reference` en `checkout_sessions` para mapear webhooks.
- Validar precios en servidor antes de marcar `checkout_session` como `completed`.

### Infra y PWA
- Configurar `next-pwa` para offline caching del JSON de productos.
- Service Worker: cache de App Shell + assets críticos; estrategia stale-while-revalidate para productos.

### Seguridad en webhooks
- Siempre verificar la firma del webhook de Mercado Pago (o el proveedor que uses).
- Rechazar peticiones sin firma válida.

---

## 11. Notas finales y filosofía

- **Agnosticismo:** Diseña la UI y los hooks para que no dependan de Supabase; el único lugar con llamadas directas debe ser `/src/services`.
- **Mantenibilidad:** centraliza la lógica de negocio; los cambios (p. ej. reglas de packs) deben tocar **una sola** función/servicio.
- **UX primero:** prioridad móvil, skeletons, theming instantáneo y touch targets adecuados para que la PWA se sienta nativa.
- **Logs y monitoreo:** desde el inicio incluye un sistema básico de logs (al menos console + tabla de errores) para depurar fallos en producción.

## Progreso

1. **Infraestructura base**  
   - Proyecto Next.js 16 (App Router) con TypeScript y Tailwind CSS.  
   - Estructura de carpetas profesional (`/src/app`, `/src/components`, `/src/services`, `/src/domain`, `/src/hooks`, `/src/store`, `/src/lib`, `/src/types`, `/src/providers`).  
   - Variables CSS para theming dinámico (soporte multi‑tienda).

2. **Base de datos y Supabase**  
   - Esquema completo ejecutado en Supabase (tablas: `profiles`, `stores`, `store_settings`, `categories`, `products`, `pricing_rules`, `composition_groups`, `composition_items`, `checkout_sessions`, `orders`, `order_items`, `order_item_compositions`, `payment_integrations`, `payments`, `subscription_plans`, `subscriptions`, `whatsapp_message_queue`, `push_subscriptions`).  
   - Índices de rendimiento agregados.  
   - Tipos TypeScript generados automáticamente (`src/types/database.types.ts`).  
   - Clientes de Supabase tipados (`client.ts`, `server.ts`).  
   - Trigger para creación automática de perfil al registrarse.

3. **Autenticación completa**  
   - `AuthProvider` con React Context y manejo de sesión.  
   - Páginas `/auth/login` y `/auth/register` con formularios funcionales.  
   - Integración con Supabase Auth (correo/contraseña, confirmación por email, recuperación).  
   - Protección de rutas futuras (base preparada).

4. **Proxy de subdominios (antes middleware)**  
   - Archivo `src/proxy.ts` con lógica robusta para detectar subdominios (`tienda.localhost`, `tienda.foodynow.com`).  
   - Reescribe internamente a `/store/[slug]`, permitiendo multi‑tenencia por subdominio.

5. **Componentes UI base**  
   - Instalación de Shadcn/UI con preset **Base UI** y estilo **Maia**.  
   - Componentes añadidos: `button`, `card`, `dialog`, `sheet`, `skeleton`, `tabs`, `sonner` (toasts).  
   - Toaster integrado en `layout.tsx`.

6. **Estado y lógica temprana**  
   - Store de carrito con Zustand + persistencia (esqueleto en `src/store/cartStore.ts`).  
   - Funciones puras de pricing en `src/domain/pricing.ts` (soporte para packs y reglas por cantidad).

7. **Tienda de prueba funcional**  
   - SQL para crear tienda de ejemplo (`slug = 'mitienda'`) usando el usuario autenticado.  
   - Verificación de que `http://mitienda.local:3000` muestra la página de la tienda (sin 404).

---

### Decisiones de diseño y arquitectura clave

| Área | Decisión |
|------|-----------|
| **Framework** | Next.js 16 (App Router) con Turbopack para desarrollo rápido. |
| **Gestor de paquetes** | `pnpm` por velocidad y eficiencia de disco. |
| **Estilos** | Tailwind CSS + variables CSS (modo oscuro listo). |
| **UI Library** | Shadcn/UI sobre **Base UI** (futuro del ecosistema, bundles más pequeños). |
| **Preset visual** | **Maia** (bordes suaves, spacing amigable para app de comida). |
| **Backend / DB** | Supabase (PostgreSQL + Auth + Storage). Se usará como único backend hasta migrar a Laravel. |
| **Auth** | Supabase Auth con correo/contraseña. Trigger `on_auth_user_created` para poblar `profiles`. |
| **Multi‑tenencia** | Subdominios + slug en URL. Proxy de Next.js para reescribir. |
| **Estado global** | Zustand con persistencia (localStorage). |
| **Data fetching** | TanStack Query (ya instalado, listo para Fase 2). |
| **Type safety** | Tipos generados desde Supabase, uso estricto de TypeScript. |
| **Organización** | Capas: `services` (llamadas a infraestructura), `domain` (lógica pura), `hooks` (reactivos), `store` (estado). |

---

### Estructura de carpetas actual (post Sprint 1)

```
src/
├── app/
│   ├── api/webhooks/          (futuros webhooks de MP)
│   ├── auth/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── dashboard/             (panel de control del owner)
│   ├── store/[slug]/page.tsx  (página dinámica de cada tienda)
│   ├── favicon.ico
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx               (landing principal)
├── components/
│   ├── features/
│   │   ├── Cart/
│   │   ├── Checkout/
│   │   └── ProductGrid/
│   └── ui/                    (componentes Shadcn)
│       ├── button.tsx
│       ├── card.tsx
│       ├── dialog.tsx
│       ├── sheet.tsx
│       ├── skeleton.tsx
│       ├── sonner.tsx
│       └── tabs.tsx
├── domain/
│   └── pricing.ts             (futuro, funciones puras de cálculo)
├── hooks/
│   └── useProducts.ts         (futuro)
├── lib/
│   └── supabase/
│       ├── client.ts
│       ├── server.ts
│       └── utils.ts
├── providers/
│   └── auth-provider.tsx
├── services/
│   ├── supabase.ts            (cliente singleton)
│   ├── productService.ts (futuro)
│   ├── checkoutService.ts (futuro)
│   └── orderService.ts (futuro)
├── store/
│   └── cartStore.ts (futuro)
├── types/
│   ├── database.types.ts      (generado por Supabase)
│   └── proxy.ts               (archivo de configuración del proxy)
├── proxy.ts                   (middleware moderno)
└── ... (config files)
```
---

### Dependencias vitales instaladas

| Nombre | Versión / Rol |
|--------|----------------|
| **next** | 16.2.4 con Turbopack |
| **react / react-dom** | 19.x (latest) |
| **pnpm** | Gestor de paquetes principal |
| **tailwindcss** | Framework CSS |
| **tailwindcss-animate** | Animaciones para Tailwind |
| **shadcn/ui** | CLI + componentes (Base UI, Maia) |
| **@supabase/supabase-js** | Cliente universal |
| **@supabase/ssr** | Cliente para Server Components y cookies |
| **zustand** | Estado global + persistencia |
| **@tanstack/react-query** | Fetching, caché, optimistic updates |
| **lucide-react** | Iconos |
| **sonner** | Toasts (via shadcn) |
| **class-variance-authority, clsx, tailwind-merge** | Utilidades para componentes |

*Nota: No se incluye `jest` o `vitest` aún (se agregará en Fase 2 para testear pricing).*

---

## 12. Roadmap

FASE 1: Cimientos y "El Esqueleto" (TERMINADO)
 - Objetivo: Tener la infraestructura lista y la base de datos respirando.
 - Setup Inicial: Repositorio, Next.js con el sistema de carpetas /src/services, /src/domain, etc.
 - Configuración de Tailwind: Inyectar los Design Tokens (variables CSS) en el layout principal.
 - Base de Datos (Supabase): Ejecutar el SQL del Modelo V3. Crear las tablas de stores, products y pricing_rules.
 - Middleware de Subdominios: Implementar la lógica para que tienda.foodynow.com sepa qué store_id cargar.

FASE 1.5: Sistema de usuarios (TERMINADO)
 - Objetivo: que usuarios se puedan registrar y loguear, tanto con mail como con google

FASE 2: El Cerebro (Motor de Pricing)
 - Objetivo: Que el sistema sepa calcular cuánto cuesta una docena de empanadas sin errores.
 - Implementación de pricing.ts: Escribir las funciones puras en la capa de Dominio.
 - Unit Testing: Crear pruebas para el motor (ej: "Si agrego 12 empanadas de $1000, pero hay un pack de 12 a $9000, el total debe ser $9000").
 - Product Service: Crear el servicio que trae los productos y categorías de Supabase.

FASE 3: Storefront y Carrito (UX Crítica)
 - Objetivo: Que el cliente final pueda elegir comida y ver su total.
 - Menú de Productos: Implementar la vista con Skeletons de carga.
 - Carrito con Zustand: Crear el store global que persista en LocalStorage.
 - Modales de Composición: La interfaz para elegir sabores con validación de "mínimo/máximo".
 - App Shell: Barra de navegación inferior para móvil y feedback táctil (active:scale).

FASE 4: El Flujo del Dinero (Pagos)
 - Objetivo: Poder cobrar.
 - Checkout Session: Servicio para validar el carrito en el servidor y crear el "borrador" en la DB.
 - Integración Mercado Pago: Generar el link de pago (Preferencia).
 - Webhook (Supabase Edge Function): Escuchar el aviso de pago de MP y mover la sesión a la tabla orders.

FASE 5: Admin Panel "Full" (Gestión)
 - Objetivo: Que el dueño de la tienda pueda configurar todo lo realacionado a su tienda.
 - Dashboard de Pedidos: Vista en tiempo real (Supabase Realtime) para que el local vea qué cocinar.
 - Configurador de Tema: Un formulario intuitivo para cambiar el o los colores primarios de la tienda en la DB.
 - Gestor de Stock: Botón rápido para marcar un producto como "Agotado", administrar cantidades, ingresos y egresos. Es un módulo opcional que no debe frenar el uso del resto de funciones.
 - Módulo de Impresión Térmica: Implementación del estándar de 80mm utilizando window.print() y el componente buildTicketHtml para garantizar compatibilidad con impresoras de comandas.

FASE 6: Pulido PWA y Lanzamiento
 - Objetivo: Que se sienta como una App nativa.
 - Configuración de PWA: Manifest, iconos y Service Worker para modo offline básico.
 - Optimización de Imágenes: Asegurar que todas las fotos de comida pasen por el componente next/image.
 - Onboarding: Preparar la cuenta del primer cliente real y testear el flujo de punta a punta.

Tip de "Guía Experto": El Wildcard de Observabilidad
Antes de lanzar el primer cliente, añade una herramienta de Error Tracking (como Sentry o LogSnag). En un SaaS de comida, si el botón de "Pagar" falla un viernes a las 21:00 hs, necesitas saberlo antes de que el cliente te llame enojado.
Nota técnica sobre el código de impresión de tickets:
Agnosticismo de Estilos: Al abrir una nueva ventana (window.open) e inyectar el HTML con su propio <style>, te aseguras de que Tailwind o los estilos globales de Next.js no interfieran con las dimensiones exactas de la impresora.
Snapshot de Datos: El ticket usa los datos del pedido en ese instante, lo cual es perfecto para auditorías rápidas.
Tip:
En el buildTicketHtml, asegúrate de que los nombres de los productos largos tengan un line-height adecuado o un word-break, ya que en las impresoras térmicas de 80mm, un nombre de producto muy largo (ej: "Pizza Especial con Jamón, Morrones y Doble Muzza") podría romper el alineamiento del precio si no se controla.