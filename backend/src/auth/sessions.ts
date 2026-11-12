import crypto from 'node:crypto';
import { pool } from '../db.js';
import { config } from '../config.js';

export interface UsuarioSesion {
  id: string;
  usuario: string;
  nombre: string;
  rol: 'admin' | 'normal';
}

export function crearToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function crearSesion(usuarioId: string): Promise<string> {
  const token = crearToken();
  const id = crypto.randomUUID();
  const expira = Date.now() + config.diasSesion * 24 * 60 * 60 * 1000;
  await pool.query(
    'INSERT INTO sesiones (id, token_hash, usuario_id, expira) VALUES (?, ?, ?, ?)',
    [id, hashToken(token), usuarioId, expira]
  );
  return token;
}

export async function usuarioPorToken(token: string): Promise<UsuarioSesion | null> {
  const [rows]: any = await pool.query(
    `SELECT u.id, u.usuario, u.nombre, u.rol
       FROM sesiones s
       JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ? AND s.expira > ? AND u.activo = 1
      LIMIT 1`,
    [hashToken(token), Date.now()]
  );
  return rows.length ? (rows[0] as UsuarioSesion) : null;
}

export async function borrarSesion(token: string): Promise<void> {
  await pool.query('DELETE FROM sesiones WHERE token_hash = ?', [hashToken(token)]);
}

export async function borrarSesionesDeUsuario(usuarioId: string): Promise<void> {
  await pool.query('DELETE FROM sesiones WHERE usuario_id = ?', [usuarioId]);
}

/** Limpia sesiones vencidas; se llama al iniciar el servidor. */
export async function limpiarSesionesVencidas(): Promise<void> {
  await pool.query('DELETE FROM sesiones WHERE expira <= ?', [Date.now()]);
}
