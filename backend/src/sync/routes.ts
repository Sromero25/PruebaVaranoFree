import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { autenticar } from '../auth/middleware.js';
import { procesarPush } from './push.js';
import { procesarPull } from './pull.js';
import { pushSchema } from './types.js';

export const syncRouter = Router();

syncRouter.use(autenticar);

const pullQuerySchema = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

syncRouter.post('/push', async (req, res, next) => {
  try {
    const datos = pushSchema.safeParse(req.body);
    if (!datos.success) {
      res.status(400).json({ error: 'Paquete de sincronización inválido.', detalles: datos.error.issues.map(i => i.message) });
      return;
    }

    const usuarioId = req.usuario!.id;
    const dispositivoId = datos.data.device_id ?? null;

    if (dispositivoId) {
      await pool.query(
        `INSERT INTO dispositivos (id, nombre, usuario_id, ultimo_sync)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), usuario_id = VALUES(usuario_id), ultimo_sync = NOW()`,
        [dispositivoId, datos.data.device_name?.slice(0, 80) || 'Dispositivo', usuarioId]
      );
    }

    const resultados = await procesarPush(datos.data.cambios, usuarioId, dispositivoId, req.usuario!.rol);
    const advertencias = resultados.flatMap(r => r.advertencias ?? []);
    res.json({ resultados, advertencias });
  } catch (error) {
    next(error);
  }
});

syncRouter.get('/pull', async (req, res, next) => {
  try {
    const datos = pullQuerySchema.safeParse(req.query);
    if (!datos.success) {
      res.status(400).json({ error: 'Parámetros inválidos.' });
      return;
    }
    const resultado = await procesarPull(datos.data.since, datos.data.limit);
    res.json(resultado);
  } catch (error) {
    next(error);
  }
});

syncRouter.get('/estado', async (req, res, next) => {
  try {
    const [rows]: any = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM ventas WHERE estado = 'activa') AS ventas,
         (SELECT COUNT(*) FROM compras WHERE estado = 'activa') AS compras,
         (SELECT COUNT(*) FROM tallas WHERE stock < 0) AS tallas_negativas,
         (SELECT COALESCE(MAX(seq), 0) FROM sync_cambios) AS ultimo_seq`
    );
    res.json({ estado: 'ok', resumen: rows[0], usuario: req.usuario });
  } catch (error) {
    next(error);
  }
});
