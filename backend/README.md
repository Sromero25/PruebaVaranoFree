# Varano API

Backend central (Node + Express + MySQL) para el Taller de Calzado. El frontend
funciona offline con IndexedDB y sincroniza contra esta API cuando hay internet.

## Requisitos

- Node.js 20 o superior
- MySQL 8

## Puesta en marcha local

```powershell
npm install
Copy-Item .env.example .env
# Edita .env con los datos reales de MySQL
npm run migrate
npm run dev
```

La API queda en `http://localhost:3000/api`. El health check es
`GET /api/health`.

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `PORT` | Puerto HTTP (por defecto 3000). |
| `NODE_ENV` | `development` o `production`. |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_POOL` | Conexión MySQL. |
| `CORS_ORIGIN` | Orígenes permitidos, separados por coma. |
| `SESSION_DAYS` | Duración de la sesión en días (por defecto 30). |
| `ADMIN_INVITE_CODE` | Código para crear administradores desde "Crear cuenta". Vacío = deshabilitado. |

No subas `.env` a Git. Si la contraseña de MySQL se compartió, cámbiala.

## Primer acceso

La base debe estar vacía de usuarios. El primer administrador se crea desde la
pantalla de la app o con:

```http
POST /api/auth/bootstrap
Content-Type: application/json

{ "usuario": "admin", "nombre": "Administrador", "password": "una-clave-larga" }
```

Ese endpoint solo funciona una vez. Después, los usuarios y contraseñas se
gestionan en línea desde el panel de administración.

`POST /api/auth/registro` permite que una persona cree su propia cuenta. Siempre
crea rol `normal`; solo devuelve rol `admin` si se envía `codigo_admin` y coincide
con `ADMIN_INVITE_CODE`. Si todavía no existe ningún usuario, responde `409` para
forzar la creación del administrador inicial.

## Sincronización

- `POST /api/sync/push`: recibe cambios locales. Cada cambio puede llevar
  `idempotency_key`; si ya se recibió, responde `duplicado` sin volver a
  aplicarlo.
- `GET /api/sync/pull?since=<seq>&limit=200`: devuelve los cambios posteriores
  al cursor, en orden.
- `GET /api/sync/estado`: resumen para diagnóstico.

El servidor es la autoridad del stock. Si dos dispositivos venden el último par
sin conexión, ambas ventas se aceptan, el stock queda negativo y la respuesta
incluye `advertencias` con `tipo: "stock_negativo"`.

Tablas de historial: `auditoria`, `movimientos_inventario`, `sync_cambios`,
`sync_recibidos` y `dispositivos`. Los borrados son lógicos (`deleted_at`) y las
ventas/compras anuladas conservan su registro (`estado = 'anulada'`).

## Costos y utilidad

- `productos.costo_base` guarda el costo vigente por par de cada modelo.
- `producto_costos` conserva el historial de cambios de costo con su fecha.
- `venta_detalle.costo_unitario` guarda una instantánea del costo al momento de
  la venta, de modo que subir el costo después no altera facturas pasadas.
- La utilidad se calcula como ingresos − costo de lo vendido. Las compras de
  materia prima son inversión de inventario y se muestran aparte, sin restarse.
- Si un cliente antiguo envía una venta sin costo, el servidor usa el costo
  vigente del modelo como respaldo. La app avisa cuántos pares quedaron sin
  costo registrado para que la utilidad se interprete con cuidado.

## Producción

```powershell
npm run build
npm start
```

- Usa HTTPS delante del proceso (Nginx, Caddy, etc.).
- Define `CORS_ORIGIN` con el dominio real del frontend.
- En el frontend, define `VITE_API_URL` antes de compilar:

```env
VITE_API_URL=https://api.tu-dominio.com/api
```

Si el frontend se sirve desde el mismo dominio que la API, puedes dejar
`VITE_API_URL` sin definir y se usará `/api`.
