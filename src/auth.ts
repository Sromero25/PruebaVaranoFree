/**
 * auth.ts
 * ----------------------------------------------------------------------------
 * Usuarios, inicio de sesión, sesión persistente y control de permisos.
 *
 * Roles:
 *  - admin : todo, incluidas las correcciones y el panel de administración.
 *  - normal: registrar ventas/compras/clientes y dar de alta calzado.
 *
 * Sesión persistente: al iniciar con "mantener sesión" se guarda un token
 * aleatorio en localStorage (30 días); si no, en sessionStorage (hasta cerrar la
 * pestaña). La BD sólo guarda el hash del token.
 *
 * IMPORTANTE: la app corre 100 % en el navegador, así que estos controles
 * protegen el uso normal, no a alguien con acceso a las herramientas de
 * desarrollador del equipo. Para seguridad real hace falta un servidor.
 */

import { db, type Rol, type Usuario } from './db.js';
import { hashPassword, generarAleatorioHex, sha256Hex, compararSeguro } from './seguridad.js';

export interface UsuarioPublico {
  IDUsuario: number;
  Usuario: string;
  Nombre: string;
  Rol: Rol;
}

const CLAVE_TOKEN = 'varano.token';
const CLAVE_INTENTOS = 'varano.intentos';
const DIAS_SESION = 30;
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 60_000;
/** Sal de relleno para gastar el mismo tiempo cuando el usuario no existe. */
const SAL_FALSA = '00112233445566778899aabbccddeeff';

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

// ---------------------------------------------------------------- utilidades

const publico = (u: Usuario): UsuarioPublico => ({
  IDUsuario: u.IDUsuario as number,
  Usuario: u.Usuario,
  Nombre: u.Nombre,
  Rol: u.Rol
});

function validarPassword(password: string): void {
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  if (password.length > 128) throw new Error('La contraseña es demasiado larga.');
}

function leerIntentos(): { n: number; bloqueoHasta: number } {
  try {
    const crudo = localStorage.getItem(CLAVE_INTENTOS);
    if (crudo) {
      const d = JSON.parse(crudo) as { n?: number; bloqueoHasta?: number };
      return { n: Number(d.n) || 0, bloqueoHasta: Number(d.bloqueoHasta) || 0 };
    }
  } catch { /* almacenamiento no disponible */ }
  return { n: 0, bloqueoHasta: 0 };
}

function guardarIntentos(n: number, bloqueoHasta: number): void {
  try { localStorage.setItem(CLAVE_INTENTOS, JSON.stringify({ n, bloqueoHasta })); } catch { /* ignorar */ }
}

function leerToken(): string | null {
  try { return localStorage.getItem(CLAVE_TOKEN) ?? sessionStorage.getItem(CLAVE_TOKEN); } catch { return null; }
}

function borrarToken(): void {
  try { localStorage.removeItem(CLAVE_TOKEN); sessionStorage.removeItem(CLAVE_TOKEN); } catch { /* ignorar */ }
}

// ---------------------------------------------------------------- usuarios

export async function hayUsuarios(): Promise<boolean> {
  return (await db.usuarios.count()) > 0;
}

/**
 * Crea un usuario. Si todavía no existe ninguno, crea el primer administrador
 * sin requerir sesión; después sólo un administrador puede crear usuarios.
 */
export async function crearUsuario(d: { usuario: string; nombre: string; password: string; rol: Rol }): Promise<void> {
  const total = await db.usuarios.count();
  if (total > 0) requerirAdmin();

  const usuario = d.usuario.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) {
    throw new Error('El usuario debe tener 3 a 30 caracteres: letras, números, punto, guion o guion bajo.');
  }
  const nombre = d.nombre.trim();
  if (nombre.length < 1 || nombre.length > 60) throw new Error('El nombre es obligatorio (máximo 60 caracteres).');
  validarPassword(d.password);
  const rol: Rol = total === 0 ? 'admin' : d.rol;
  if (rol !== 'admin' && rol !== 'normal') throw new Error('Rol no válido.');

  if (await db.usuarios.where('Usuario').equals(usuario).first()) {
    throw new Error('Ese nombre de usuario ya existe.');
  }

  const Sal = generarAleatorioHex(16);
  const Hash = await hashPassword(d.password, Sal);
  await db.usuarios.add({ Usuario: usuario, Nombre: nombre, Rol: rol, Sal, Hash, Activo: 1 });
}

export async function listarUsuarios(): Promise<(UsuarioPublico & { Activo: boolean })[]> {
  requerirAdmin();
  const lista = await db.usuarios.toArray();
  return lista.map(u => ({ ...publico(u), Activo: u.Activo === 1 }));
}

/** Cambia la contraseña (el propio usuario o un administrador) y cierra sus demás sesiones. */
export async function cambiarPassword(IDUsuario: number, nueva: string): Promise<void> {
  requerirSesion();
  if (actual?.IDUsuario !== IDUsuario) requerirAdmin();
  validarPassword(nueva);

  const Sal = generarAleatorioHex(16);
  const Hash = await hashPassword(nueva, Sal);
  await db.usuarios.update(IDUsuario, { Sal, Hash });

  const tokenActual = leerToken();
  const hashActual = tokenActual ? await sha256Hex(tokenActual) : '';
  await db.sesiones.where('IDUsuario').equals(IDUsuario).filter(s => s.TokenHash !== hashActual).delete();
}

export async function cambiarEstadoUsuario(IDUsuario: number, activo: boolean): Promise<void> {
  requerirAdmin();
  if (actual?.IDUsuario === IDUsuario) throw new Error('No puedes desactivar tu propio usuario.');
  const u = await db.usuarios.get(IDUsuario);
  if (!u) throw new Error('El usuario no existe.');

  if (!activo && u.Rol === 'admin') {
    const admins = await db.usuarios.filter(x => x.Rol === 'admin' && x.Activo === 1).count();
    if (admins <= 1) throw new Error('Debe quedar al menos un administrador activo.');
  }
  await db.usuarios.update(IDUsuario, { Activo: activo ? 1 : 0 });
  if (!activo) await db.sesiones.where('IDUsuario').equals(IDUsuario).delete();
}

// ---------------------------------------------------------------- sesión

async function abrirSesion(u: Usuario, recordar: boolean): Promise<void> {
  const token = generarAleatorioHex(32);
  await db.sesiones.add({
    TokenHash: await sha256Hex(token),
    IDUsuario: u.IDUsuario as number,
    Expira: Date.now() + DIAS_SESION * 24 * 60 * 60 * 1000
  });
  borrarToken();
  try { (recordar ? localStorage : sessionStorage).setItem(CLAVE_TOKEN, token); } catch { /* ignorar */ }
  actual = publico(u);
}

/** Inicia sesión. Bloquea 60 s tras 5 intentos fallidos seguidos. */
export async function iniciarSesion(usuario: string, password: string, recordar: boolean): Promise<void> {
  const { n, bloqueoHasta } = leerIntentos();
  if (bloqueoHasta > Date.now()) {
    throw new Error(`Demasiados intentos. Espera ${Math.ceil((bloqueoHasta - Date.now()) / 1000)} segundos.`);
  }

  const u = await db.usuarios.where('Usuario').equals(usuario.trim().toLowerCase()).first();
  const hash = await hashPassword(password, u?.Sal ?? SAL_FALSA);
  const ok = !!u && u.Activo === 1 && compararSeguro(hash, u.Hash);

  if (!ok || !u) {
    const nuevo = n + 1;
    guardarIntentos(nuevo >= MAX_INTENTOS ? 0 : nuevo, nuevo >= MAX_INTENTOS ? Date.now() + BLOQUEO_MS : 0);
    throw new Error('Usuario o contraseña incorrectos.');
  }

  guardarIntentos(0, 0);
  await abrirSesion(u, recordar);
}

/** Intenta reanudar una sesión guardada. Devuelve `true` si sigue vigente. */
export async function restaurarSesion(): Promise<boolean> {
  await db.sesiones.where('Expira').below(Date.now()).delete();

  const token = leerToken();
  if (!token) return false;

  const s = await db.sesiones.where('TokenHash').equals(await sha256Hex(token)).first();
  const u = s ? await db.usuarios.get(s.IDUsuario) : undefined;
  if (!s || !u || u.Activo !== 1) {
    borrarToken();
    return false;
  }
  actual = publico(u);
  return true;
}

export async function cerrarSesion(): Promise<void> {
  const token = leerToken();
  if (token) await db.sesiones.where('TokenHash').equals(await sha256Hex(token)).delete();
  borrarToken();
  actual = null;
}