/**
 * api.ts
 * ----------------------------------------------------------------------------
 * Cliente HTTP del backend central. La URL sale de `VITE_API_URL`.
 * En desarrollo, si no está definida, usa el backend local; en producción usa
 * el mismo origen (`/api`) para no hardcodear localhost.
 */

import type { EntidadSync } from './db.js';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
  ?? (import.meta.env.DEV ? 'http://localhost:3000/api' : '/api');

export class ApiError extends Error {
  readonly estado: number;
  readonly detalles?: string[];

  constructor(mensaje: string, estado: number, detalles?: string[]) {
    super(mensaje);
    this.name = 'ApiError';
    this.estado = estado;
    this.detalles = detalles;
  }
}

export function leerTokenApi(): string | null {
  try {
    return localStorage.getItem('varano.token') ?? sessionStorage.getItem('varano.token');
  } catch {
    return null;
  }
}

async function apiFetch<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ApiError('No hay conexión con el servidor.', 0);
  }
  const cabeceras = new Headers(opciones.headers);
  cabeceras.set('Accept', 'application/json');
  if (opciones.body !== undefined && !cabeceras.has('Content-Type')) {
    cabeceras.set('Content-Type', 'application/json');
  }
  const token = leerTokenApi();
  if (token) cabeceras.set('Authorization', `Bearer ${token}`);

  let respuesta: Response;
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), 12_000);
  try {
    respuesta = await fetch(`${BASE}${ruta}`, { ...opciones, headers: cabeceras, signal: control.signal });
  } catch {
    throw new ApiError('No hay conexión con el servidor.', 0);
  } finally {
    clearTimeout(temporizador);
  }

  let cuerpo: any = null;
  const texto = await respuesta.text();
  if (texto) {
    try { cuerpo = JSON.parse(texto); } catch { cuerpo = { error: texto }; }
  }

  if (!respuesta.ok) {
    throw new ApiError(
      cuerpo?.error ?? `El servidor respondió ${respuesta.status}.`,
      respuesta.status,
      Array.isArray(cuerpo?.detalles) ? cuerpo.detalles : undefined
    );
  }
  // Si un hosting devuelve index.html para /api (fallback de SPA), no lo
  // tomemos como respuesta válida: es señal de que la URL del API no existe.
  if (cuerpo === null || typeof cuerpo !== 'object') {
    throw new ApiError('El servidor no respondió con datos válidos. Revisa la URL del API (VITE_API_URL).', 0);
  }
  return cuerpo as T;
}

// ---------------------------------------------------------------- auth

export interface UsuarioApi {
  id: string;
  usuario: string;
  nombre: string;
  rol: 'admin' | 'normal';
  activo: boolean;
}

export interface RespuestaLogin {
  token: string;
  usuario: UsuarioApi;
}

export const api = {
  estado: () => apiFetch<{ inicializado: boolean }>('/auth/estado'),

  bootstrap: (datos: { usuario: string; nombre: string; password: string }) =>
    apiFetch<{ usuario: UsuarioApi }>('/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify(datos)
    }),

  login: (usuario: string, password: string) =>
    apiFetch<RespuestaLogin>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ usuario, password })
    }),

  registro: (datos: { usuario: string; nombre: string; password: string; codigo_admin?: string }) =>
    apiFetch<RespuestaLogin>('/auth/registro', {
      method: 'POST',
      body: JSON.stringify(datos)
    }),

  logout: () => apiFetch<{ estado: string }>('/auth/logout', { method: 'POST' }),

  me: () => apiFetch<{ usuario: UsuarioApi }>('/auth/me'),

  listarUsuarios: () => apiFetch<{ usuarios: UsuarioApi[] }>('/auth/usuarios'),

  crearUsuario: (datos: { usuario: string; nombre: string; password: string; rol: 'admin' | 'normal' }) =>
    apiFetch<{ usuario: UsuarioApi }>('/auth/usuarios', {
      method: 'POST',
      body: JSON.stringify(datos)
    }),

  cambiarPassword: (id: string, password: string) =>
    apiFetch<{ estado: string }>(`/auth/usuarios/${encodeURIComponent(id)}/password`, {
      method: 'POST',
      body: JSON.stringify({ password })
    }),

  cambiarEstadoUsuario: (id: string, activo: boolean) =>
    apiFetch<{ estado: string }>(`/auth/usuarios/${encodeURIComponent(id)}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ activo })
    }),

  push: (device_id: string, device_name: string, cambios: CambioPush[]) =>
    apiFetch<RespuestaPush>('/sync/push', {
      method: 'POST',
      body: JSON.stringify({ device_id, device_name, cambios })
    }),

  pull: (since: number, limit = 200) =>
    apiFetch<RespuestaPull>(`/sync/pull?since=${encodeURIComponent(since)}&limit=${limit}`),

  estadoSync: () => apiFetch<{ estado: string; resumen: Record<string, number> }>('/sync/estado')
};

// ---------------------------------------------------------------- sync

export interface CambioPush {
  id: string;
  entidad: EntidadSync;
  entidad_id: string;
  operacion: 'upsert' | 'delete';
  payload: unknown;
  idempotency_key?: string;
}

export interface AdvertenciaApi {
  tipo: 'stock_negativo';
  talla_id?: string;
  materia_prima_id?: string;
  stock_resultante: number;
}

export interface ResultadoPush {
  id?: string;
  entidad: string;
  entidad_id: string;
  estado: 'aplicado' | 'duplicado' | 'conflicto' | 'error';
  mensaje?: string;
  advertencias?: AdvertenciaApi[];
  seq?: number;
}

export interface RespuestaPush {
  resultados: ResultadoPush[];
  advertencias: AdvertenciaApi[];
}

export interface CambioPull {
  seq: number;
  entidad: EntidadSync;
  entidad_id: string;
  operacion: 'upsert' | 'delete';
  payload: any;
  fecha: string;
  dispositivo_id: string | null;
}

export interface RespuestaPull {
  cambios: CambioPull[];
  nextSeq: number;
  hasMore: boolean;
}
