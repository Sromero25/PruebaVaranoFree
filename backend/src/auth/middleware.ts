import type { NextFunction, Request, Response } from 'express';
import { usuarioPorToken, type UsuarioSesion } from './sessions.js';

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioSesion;
    }
  }
}

export function tokenDeRequest(req: Request): string | null {
  const cabecera = req.headers.authorization;
  if (!cabecera?.startsWith('Bearer ')) return null;
  const token = cabecera.slice('Bearer '.length).trim();
  return token || null;
}

export async function autenticar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = tokenDeRequest(req);
    if (!token) {
      res.status(401).json({ error: 'Debes iniciar sesión.' });
      return;
    }
    const usuario = await usuarioPorToken(token);
    if (!usuario) {
      res.status(401).json({ error: 'Sesión inválida o vencida.' });
      return;
    }
    req.usuario = usuario;
    next();
  } catch (error) {
    next(error);
  }
}

export function requerirAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.usuario?.rol !== 'admin') {
    res.status(403).json({ error: 'Esta acción es solo para administradores.' });
    return;
  }
  next();
}
