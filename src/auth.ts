/**
 * auth.ts
 * ----------------------------------------------------------------------------
 * Autenticación central contra el backend.
 *
 * - El primer login y la creación del administrador requieren internet.
 * - Después, el token y el usuario se cachean para poder abrir la app sin
 *   conexión y seguir trabajando; el servidor vuelve a validar el token en
 *   cada sincronización.
 * - Crear usuarios y cambiar contraseñas se hace en línea.
 */

import { db, type Rol, type Usuario } from './db.js';
import { api, ApiError, type UsuarioApi } from './api.js';

export interface UsuarioPublico {
  IDUsuario: string;
  Usuario: string;
  Nombre: string;
  Rol: Rol;
}

const CLAVE_TOKEN = 'varano.token';
const CLAVE_USUARIO = 'varano.usuario';
const CLAVE_EXPIRA = 'varano.sesion.expira';
const DIAS_SESION = 30;

let actual: UsuarioPublico | null = null;

// ---------------------------------------------------------------- permisos

export const obtenerUsuarioActual = (): UsuarioPublico | null => actual;
export const esAdmin = (): boolean => actual?.Rol === 'admin';

export function requerirSesion(): void {
  if (!actual) throw new Error('Debes iniciar sesión.');
}

export function requerirAdmin(): void {
  if (actual?.Rol !== 'admin') throw new Error('Esta acción es solo para administradores.');
}

// ---------------------------------------------------------------- storage

const almacen = (recordar: boolean): Storage => recordar ? localStorage : sessionStorage;

function leerDeAmbos(clave: string): string | null {
  try { return localStorage.getItem(clave) ?? sessionStorage.getItem(clave); } catch { return null; }
}

function limpiarSesionLocal(): void {
  try {
    for (const clave of [CLAVE_TOKEN, CLAVE_USUARIO, CLAVE_EXPIRA]) {
      localStorage.removeItem(clave);
      sessionStorage.removeItem(clave);
    }
  } catch { /* almacenamiento no disponible */ }
}

function guardarSesionLocal(token: string, usuario: UsuarioPublico, recordar: boolean): void {
  const store = almacen(recordar);
  const expira = Date.now() + DIAS_SESION * 24 * 60 * 60 * 1000;
  try {
    limpiarSesionLocal();
    store.setItem(CLAVE_TOKEN, token);
    store.setItem(CLAVE_USUARIO, JSON.stringify(usuario));
    store.setItem(CLAVE_EXPIRA, String(expira));
  } catch { /* almacenamiento no disponible */ }
}

function leerSesionLocal(): { token: string; usuario: UsuarioPublico; expira: number } | null {
  const token = leerDeAmbos(CLAVE_TOKEN);
  const crudo = leerDeAmbos(CLAVE_USUARIO);
  const expira = Number(leerDeAmbos(CLAVE_EXPIRA) ?? 0);
  if (!token || !crudo || !Number.isFinite(expira)) return null;
  if (expira <= Date.now()) {
    limpiarSesionLocal();
    return null;
  }
  try {
    const usuario = JSON.parse(crudo) as UsuarioPublico;
    if (!usuario?.IDUsuario || !usuario?.Rol) return null;
    return { token, usuario, expira };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- cache local

const publico = (u: UsuarioPublico): UsuarioPublico => ({
  IDUsuario: u.IDUsuario,
  Usuario: u.Usuario,
  Nombre: u.Nombre,
  Rol: u.Rol
});

const desdeApi = (u: UsuarioApi): UsuarioPublico => publico({
  IDUsuario: u.id,
  Usuario: u.usuario,
  Nombre: u.nombre,
  Rol: u.rol
});

async function cachearUsuario(u: UsuarioPublico, activo = true): Promise<void> {
  const registro: Usuario = {
    IDUsuario: u.IDUsuario,
    Usuario: u.Usuario,
    Nombre: u.Nombre,
    Rol: u.Rol,
    Activo: activo ? 1 : 0,
    updated_at: new Date().toISOString()
  };
  await db.usuarios.put(registro);
}

// ---------------------------------------------------------------- usuarios

/** Situación del sistema al abrir la app. */
export type EstadoSistema = 'inicializado' | 'sin_usuarios' | 'sin_conexion';

/**
 * Consulta al servidor si ya existe al menos un usuario.
 *
 * Solo devuelve `sin_usuarios` cuando el servidor lo confirma; si la API no
 * responde (URL mal configurada, sin internet, backend caído) devuelve
 * `sin_conexion` para no mostrar por error la pantalla de "crear administrador".
 */
export async function estadoSistema(): Promise<EstadoSistema> {
  try {
    const estado = await api.estado();
    return estado.inicializado ? 'inicializado' : 'sin_usuarios';
  } catch {
    // Si hay usuarios cacheados se puede iniciar sesión sin conexión.
    if ((await db.usuarios.count()) > 0) return 'inicializado';
    return 'sin_conexion';
  }
}

export async function hayUsuarios(): Promise<boolean> {
  return (await estadoSistema()) !== 'sin_usuarios';
}

function validarPassword(password: string): void {
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  if (password.length > 128) throw new Error('La contraseña es demasiado larga.');
}

/**
 * Crea un usuario. Si el sistema está vacío, usa `/auth/bootstrap` (sólo
 * funciona una vez). Después requiere administrador y conexión.
 */
export async function crearUsuario(d: { usuario: string; nombre: string; password: string; rol: Rol }): Promise<void> {
  const usuario = d.usuario.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) {
    throw new Error('El usuario debe tener 3 a 30 caracteres: letras, números, punto, guion o guion bajo.');
  }
  const nombre = d.nombre.trim();
  if (nombre.length < 1 || nombre.length > 60) throw new Error('El nombre es obligatorio (máximo 60 caracteres).');
  validarPassword(d.password);

  const estado = await estadoSistema();
  try {
    if (estado === 'sin_usuarios') {
      const r = await api.bootstrap({ usuario, nombre, password: d.password });
      await cachearUsuario(desdeApi(r.usuario));
    } else if (estado === 'sin_conexion' && !actual) {
      throw new Error('Necesitas conexión a internet para crear la primera cuenta.');
    } else {
      requerirAdmin();
      const r = await api.crearUsuario({ usuario, nombre, password: d.password, rol: d.rol });
      await cachearUsuario(desdeApi(r.usuario));
    }
  } catch (error) {
    if (error instanceof ApiError && error.estado === 0) {
      throw new Error('Necesitas conexión a internet para crear usuarios.');
    }
    throw error;
  }
}

/**
 * Registro público controlado. Crea un usuario normal; si se envía un código
 * de invitación válido, el servidor lo crea como administrador.
 */
export async function registrarUsuario(d: {
  usuario: string;
  nombre: string;
  password: string;
  codigoAdmin?: string;
  recordar?: boolean;
}): Promise<void> {
  const usuario = d.usuario.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) {
    throw new Error('El usuario debe tener 3 a 30 caracteres: letras, números, punto, guion o guion bajo.');
  }
  const nombre = d.nombre.trim();
  if (nombre.length < 1 || nombre.length > 60) throw new Error('El nombre es obligatorio (máximo 60 caracteres).');
  validarPassword(d.password);

  try {
    const r = await api.registro({
      usuario,
      nombre,
      password: d.password,
      codigo_admin: d.codigoAdmin?.trim() || undefined
    });
    const u = desdeApi(r.usuario);
    actual = u;
    guardarSesionLocal(r.token, u, d.recordar ?? true);
    await cachearUsuario(u, r.usuario.activo);
  } catch (error) {
    if (error instanceof ApiError && error.estado === 0) {
      throw new Error('Necesitas conexión a internet para crear la cuenta.');
    }
    throw error;
  }
}

export async function listarUsuarios(): Promise<(UsuarioPublico & { Activo: boolean })[]> {
  requerirAdmin();
  try {
    const r = await api.listarUsuarios();
    const lista = r.usuarios.map(u => ({ ...desdeApi(u), Activo: u.activo }));
    await db.transaction('rw', [db.usuarios], async () => {
      for (const u of r.usuarios) await cachearUsuario(desdeApi(u), u.activo);
    });
    return lista;
  } catch (error) {
    if (error instanceof ApiError && error.estado === 0) {
      const cache = await db.usuarios.toArray();
      return cache.map(u => ({ ...publico(u), Activo: u.Activo === 1 }));
    }
    throw error;
  }
}

export async function cambiarPassword(IDUsuario: string, nueva: string): Promise<void> {
  requerirSesion();
  if (actual?.IDUsuario !== IDUsuario) requerirAdmin();
  validarPassword(nueva);
  try {
    await api.cambiarPassword(IDUsuario, nueva);
  } catch (error) {
    if (error instanceof ApiError && error.estado === 0) {
      throw new Error('Necesitas conexión a internet para cambiar contraseñas.');
    }
    throw error;
  }
  if (actual?.IDUsuario === IDUsuario) {
    limpiarSesionLocal();
    actual = null;
  }
}

export async function cambiarEstadoUsuario(IDUsuario: string, activo: boolean): Promise<void> {
  requerirAdmin();
  if (actual?.IDUsuario === IDUsuario) throw new Error('No puedes desactivar tu propio usuario.');
  try {
    await api.cambiarEstadoUsuario(IDUsuario, activo);
    await db.usuarios.update(IDUsuario, { Activo: activo ? 1 : 0 });
  } catch (error) {
    if (error instanceof ApiError && error.estado === 0) {
      throw new Error('Necesitas conexión a internet para activar o desactivar usuarios.');
    }
    throw error;
  }
}

// ---------------------------------------------------------------- sesión

export async function iniciarSesion(usuario: string, password: string, recordar: boolean): Promise<void> {
  const nombre = usuario.trim().toLowerCase();
  let respuesta;
  try {
    respuesta = await api.login(nombre, password);
  } catch (error) {
    if (error instanceof ApiError && error.estado === 0) {
      throw new Error('Necesitas conexión para iniciar sesión. Si ya entraste antes en este equipo, recarga la app y se restaurará tu sesión.');
    }
    throw error;
  }

  const u = desdeApi(respuesta.usuario);
  actual = u;
  guardarSesionLocal(respuesta.token, u, recordar);
  await cachearUsuario(u, respuesta.usuario.activo);
}

/** Reanuda una sesión cacheada. Funciona sin internet. */
export async function restaurarSesion(): Promise<boolean> {
  const sesion = leerSesionLocal();
  if (!sesion) return false;

  actual = publico(sesion.usuario);
  await cachearUsuario(actual);

  // Validación silenciosa: si el servidor dice que el token ya no sirve, se cierra.
  try {
    const r = await api.me();
    const u = desdeApi(r.usuario);
    actual = u;
    guardarSesionLocal(sesion.token, u, localStorage.getItem(CLAVE_TOKEN) !== null);
    await cachearUsuario(u);
  } catch (error) {
    if (error instanceof ApiError && error.estado === 401) {
      limpiarSesionLocal();
      actual = null;
      return false;
    }
    // Sin conexión: seguimos con la sesión cacheada.
  }
  return true;
}

export async function cerrarSesion(): Promise<void> {
  try { await api.logout(); } catch { /* sin conexión: se cierra localmente */ }
  limpiarSesionLocal();
  actual = null;
}
