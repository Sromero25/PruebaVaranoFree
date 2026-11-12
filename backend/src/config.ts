import dotenv from 'dotenv';

dotenv.config();

const numero = (valor: string | undefined, porDefecto: number): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
};

/**
 * Acepta una URL tipo `mysql://usuario:clave@host:puerto/base`.
 * La usan plataformas como Railway (`MYSQL_URL`), Aiven o servicios que
 * exponen `DATABASE_URL`.
 */
function desdeUrl(url: string | undefined): {
  host?: string; port?: number; user?: string; password?: string; database?: string;
} {
  if (!url) return {};
  try {
    const u = new URL(url);
    return {
      host: u.hostname || undefined,
      port: u.port ? Number(u.port) : undefined,
      user: decodeURIComponent(u.username) || undefined,
      password: decodeURIComponent(u.password) || undefined,
      database: decodeURIComponent(u.pathname.replace(/^\//, '')) || undefined
    };
  } catch {
    return {};
  }
}

const url = desdeUrl(process.env.MYSQL_URL ?? process.env.DATABASE_URL ?? process.env.DB_URL);

export const config = {
  puerto: numero(process.env.PORT, 3000),
  db: {
    host: process.env.DB_HOST ?? process.env.MYSQLHOST ?? url.host ?? 'localhost',
    port: numero(process.env.DB_PORT ?? process.env.MYSQLPORT, url.port ?? 3306),
    user: process.env.DB_USER ?? process.env.MYSQLUSER ?? url.user ?? 'varano_app',
    password: process.env.DB_PASSWORD ?? process.env.MYSQLPASSWORD ?? url.password ?? '',
    database: process.env.DB_NAME ?? process.env.MYSQLDATABASE ?? url.database ?? 'varano',
    connectionLimit: numero(process.env.DB_POOL, 10),
    // Aiven y otros MySQL gestionados exigen TLS.
    ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {})
  },
  corsOrigenes: (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:4173,http://localhost:3000')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean),
  diasSesion: numero(process.env.SESSION_DAYS, 30),
  /** Código opcional para que el registro público pueda crear administradores. */
  codigoAdmin: (process.env.ADMIN_INVITE_CODE ?? '').trim(),
  esProduccion: process.env.NODE_ENV === 'production'
};

/**
 * Comprueba un origen permitido. Admite `*` para subdominios, por ejemplo
 * `https://*.vercel.app` (útil con los previews de Vercel).
 */
export function origenPermitido(origin: string): boolean {
  return config.corsOrigenes.some(patron => {
    if (!patron.includes('*')) return patron === origin;
    const escapado = patron.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escapado}$`).test(origin);
  });
}
