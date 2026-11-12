import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { hashPassword, verificarPassword } from './passwords.js';
import { crearSesion, borrarSesion, borrarSesionesDeUsuario } from './sessions.js';
import { autenticar, requerirAdmin, tokenDeRequest } from './middleware.js';
import { auditar } from '../auditoria.js';
import { config } from '../config.js';

export const authRouter = Router();

const usuarioSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/, 'Usuario inválido.');
const passwordSchema = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(128);
const nombreSchema = z.string().trim().min(1).max(60);

const credencialesSchema = z.object({
  usuario: usuarioSchema,
  password: passwordSchema
});

const registroSchema = z.object({
  usuario: usuarioSchema,
  nombre: nombreSchema,
  password: passwordSchema,
  rol: z.enum(['admin', 'normal']).optional()
});

const registroPublicoSchema = z.object({
  usuario: usuarioSchema,
  nombre: nombreSchema,
  password: passwordSchema,
  codigo_admin: z.string().trim().max(100).optional()
});

const passwordCambioSchema = z.object({ password: passwordSchema });
const estadoSchema = z.object({ activo: z.boolean() });

function usuarioPublico(u: any) {
  return {
    id: u.id,
    usuario: u.usuario,
    nombre: u.nombre,
    rol: u.rol,
    activo: u.activo === 1 || u.activo === true
  };
}

function responderErrorValidacion(res: any, error: z.ZodError): void {
  res.status(400).json({ error: 'Datos inválidos.', detalles: error.issues.map(i => i.message) });
}

authRouter.get('/estado', async (_req, res, next) => {
  try {
    const [rows]: any = await pool.query('SELECT COUNT(*) AS total FROM usuarios');
    res.json({ inicializado: Number(rows[0].total) > 0 });
  } catch (error) {
    next(error);
  }
});

/** Sólo funciona cuando la tabla de usuarios está vacía. */
authRouter.post('/bootstrap', async (req, res, next) => {
  try {
    const datos = registroSchema.safeParse(req.body);
    if (!datos.success) return responderErrorValidacion(res, datos.error);

    const [conteo]: any = await pool.query('SELECT COUNT(*) AS total FROM usuarios');
    if (Number(conteo[0].total) > 0) {
      res.status(409).json({ error: 'El sistema ya tiene usuarios. Inicia sesión.' });
      return;
    }

    const { sal, hash } = await hashPassword(datos.data.password);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO usuarios (id, usuario, nombre, rol, sal, hash, activo)
       VALUES (?, ?, ?, 'admin', ?, ?, 1)`,
      [id, datos.data.usuario, datos.data.nombre, sal, hash]
    );
    await auditar(pool as any, {
      usuarioId: id,
      entidad: 'usuario',
      entidadId: id,
      accion: 'bootstrap_admin',
      despues: { usuario: datos.data.usuario, nombre: datos.data.nombre, rol: 'admin' }
    });
    res.status(201).json({ usuario: { id, usuario: datos.data.usuario, nombre: datos.data.nombre, rol: 'admin', activo: true } });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const datos = credencialesSchema.safeParse(req.body);
    if (!datos.success) return responderErrorValidacion(res, datos.error);

    const [rows]: any = await pool.query(
      'SELECT id, usuario, nombre, rol, sal, hash, activo FROM usuarios WHERE usuario = ? LIMIT 1',
      [datos.data.usuario]
    );
    const u = rows[0];
    const valido = !!u && u.activo === 1 && await verificarPassword(datos.data.password, u.sal, u.hash);
    if (!valido) {
      res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      return;
    }

    const token = await crearSesion(u.id);
    await auditar(pool as any, {
      usuarioId: u.id,
      entidad: 'usuario',
      entidadId: u.id,
      accion: 'login'
    });
    res.json({ token, usuario: usuarioPublico(u) });
  } catch (error) {
    next(error);
  }
});

/**
 * Registro público controlado. Crea siempre usuarios normales.
 * Un administrador solo puede crearse con el código de invitación configurado
 * en `ADMIN_INVITE_CODE` o desde el panel de administración.
 */
authRouter.post('/registro', async (req, res, next) => {
  try {
    const datos = registroPublicoSchema.safeParse(req.body);
    if (!datos.success) return responderErrorValidacion(res, datos.error);

    const [conteo]: any = await pool.query('SELECT COUNT(*) AS total FROM usuarios');
    if (Number(conteo[0].total) === 0) {
      res.status(409).json({ error: 'El sistema aún no tiene administrador. Crea primero la cuenta de administrador.' });
      return;
    }

    let rol: 'admin' | 'normal' = 'normal';
    if (datos.data.codigo_admin) {
      if (!config.codigoAdmin || datos.data.codigo_admin !== config.codigoAdmin) {
        res.status(403).json({ error: 'El código de administrador no es válido.' });
        return;
      }
      rol = 'admin';
    }

    const { sal, hash } = await hashPassword(datos.data.password);
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO usuarios (id, usuario, nombre, rol, sal, hash, activo) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [id, datos.data.usuario, datos.data.nombre, rol, sal, hash]
    );
    await auditar(pool as any, {
      usuarioId: id,
      entidad: 'usuario',
      entidadId: id,
      accion: 'registro_publico',
      despues: { usuario: datos.data.usuario, nombre: datos.data.nombre, rol }
    });

    const token = await crearSesion(id);
    res.status(201).json({
      token,
      usuario: { id, usuario: datos.data.usuario, nombre: datos.data.nombre, rol, activo: true }
    });
  } catch (error: any) {
    if (error?.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Ese nombre de usuario ya existe.' });
      return;
    }
    next(error);
  }
});

authRouter.post('/logout', autenticar, async (req, res, next) => {
  try {
    const token = tokenDeRequest(req);
    if (token) await borrarSesion(token);
    res.json({ estado: 'ok' });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', autenticar, (req, res) => {
  res.json({ usuario: req.usuario });
});

authRouter.get('/usuarios', autenticar, requerirAdmin, async (_req, res, next) => {
  try {
    const [rows]: any = await pool.query(
      'SELECT id, usuario, nombre, rol, activo FROM usuarios ORDER BY nombre ASC'
    );
    res.json({ usuarios: rows.map(usuarioPublico) });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/usuarios', autenticar, requerirAdmin, async (req, res, next) => {
  try {
    const datos = registroSchema.safeParse(req.body);
    if (!datos.success) return responderErrorValidacion(res, datos.error);

    const { sal, hash } = await hashPassword(datos.data.password);
    const id = crypto.randomUUID();
    const rol = datos.data.rol ?? 'normal';
    await pool.query(
      'INSERT INTO usuarios (id, usuario, nombre, rol, sal, hash, activo) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [id, datos.data.usuario, datos.data.nombre, rol, sal, hash]
    );
    await auditar(pool as any, {
      usuarioId: req.usuario!.id,
      entidad: 'usuario',
      entidadId: id,
      accion: 'crear_usuario',
      despues: { usuario: datos.data.usuario, nombre: datos.data.nombre, rol }
    });
    res.status(201).json({ usuario: { id, usuario: datos.data.usuario, nombre: datos.data.nombre, rol, activo: true } });
  } catch (error: any) {
    if (error?.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Ese nombre de usuario ya existe.' });
      return;
    }
    next(error);
  }
});

authRouter.post('/usuarios/:id/password', autenticar, requerirAdmin, async (req, res, next) => {
  try {
    const datos = passwordCambioSchema.safeParse(req.body);
    if (!datos.success) return responderErrorValidacion(res, datos.error);

    const { sal, hash } = await hashPassword(datos.data.password);
    const [resultado]: any = await pool.query(
      'UPDATE usuarios SET sal = ?, hash = ? WHERE id = ?',
      [sal, hash, req.params.id]
    );
    if (resultado.affectedRows === 0) {
      res.status(404).json({ error: 'El usuario no existe.' });
      return;
    }
    await borrarSesionesDeUsuario(req.params.id);
    await auditar(pool as any, {
      usuarioId: req.usuario!.id,
      entidad: 'usuario',
      entidadId: req.params.id,
      accion: 'cambiar_password'
    });
    res.json({ estado: 'ok' });
  } catch (error) {
    next(error);
  }
});

authRouter.patch('/usuarios/:id/estado', autenticar, requerirAdmin, async (req, res, next) => {
  try {
    const datos = estadoSchema.safeParse(req.body);
    if (!datos.success) return responderErrorValidacion(res, datos.error);

    const id = req.params.id;
    if (id === req.usuario!.id && !datos.data.activo) {
      res.status(400).json({ error: 'No puedes desactivar tu propio usuario.' });
      return;
    }

    const [rows]: any = await pool.query('SELECT id, rol, activo FROM usuarios WHERE id = ?', [id]);
    const u = rows[0];
    if (!u) {
      res.status(404).json({ error: 'El usuario no existe.' });
      return;
    }

    if (!datos.data.activo && u.rol === 'admin') {
      const [admins]: any = await pool.query(
        "SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'admin' AND activo = 1"
      );
      if (Number(admins[0].total) <= 1) {
        res.status(400).json({ error: 'Debe quedar al menos un administrador activo.' });
        return;
      }
    }

    await pool.query('UPDATE usuarios SET activo = ? WHERE id = ?', [datos.data.activo ? 1 : 0, id]);
    if (!datos.data.activo) await borrarSesionesDeUsuario(id);
    await auditar(pool as any, {
      usuarioId: req.usuario!.id,
      entidad: 'usuario',
      entidadId: id,
      accion: datos.data.activo ? 'activar_usuario' : 'desactivar_usuario',
      antes: { activo: u.activo === 1 },
      despues: { activo: datos.data.activo }
    });
    res.json({ estado: 'ok' });
  } catch (error) {
    next(error);
  }
});
