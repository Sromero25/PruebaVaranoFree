import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, origenPermitido } from './config.js';
import { pool } from './db.js';
import { authRouter } from './auth/routes.js';
import { syncRouter } from './sync/routes.js';
import { limpiarSesionesVencidas } from './auth/sessions.js';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors({
  origin(origin, callback) {
    // Sin Origin: peticiones de servidor a servidor, curl o apps nativas.
    if (!origin) return callback(null, true);
    if (origenPermitido(origin)) return callback(null, true);
    if (!config.esProduccion && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origen no permitido: ${origin}`));
  },
  credentials: false,
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '2mb' }));

app.use(rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Espera un momento.' }
}));

const limiteLogin = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de acceso. Espera 15 minutos.' }
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ estado: 'ok', mensaje: 'Servidor activo' });
});

app.get('/api/health/db', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [rows]: any = await pool.query('SELECT 1 + 1 AS test');
    res.json({ estado: 'ok', mensaje: 'Servidor y MySQL conectados', datos: rows });
  } catch (error) {
    next(error);
  }
});

app.use('/api/auth/login', limiteLogin);
app.use('/api/auth/registro', limiteLogin);
app.use('/api/auth', authRouter);
app.use('/api/sync', syncRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error no controlado:', error);

  if (error?.code === 'ER_DUP_ENTRY') {
    res.status(409).json({ error: 'Ese registro ya existe.' });
    return;
  }
  if (error?.code === 'ER_NO_REFERENCED_ROW_2' || error?.code === 'ER_ROW_IS_REFERENCED_2') {
    res.status(409).json({ error: 'El registro depende de otro que no existe o está en uso.' });
    return;
  }
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: 'El paquete es demasiado grande.' });
    return;
  }
  if (error?.message?.startsWith('Origen no permitido')) {
    res.status(403).json({ error: 'Origen no permitido.' });
    return;
  }

  res.status(500).json({
    error: config.esProduccion ? 'Error interno del servidor.' : (error?.message ?? 'Error interno.')
  });
});

const servidor = app.listen(config.puerto, () => {
  console.log(`Varano API escuchando en http://localhost:${config.puerto}`);
  console.log(`Orígenes permitidos: ${config.corsOrigenes.join(', ')}`);
  void limpiarSesionesVencidas().catch(error => console.error('No se pudieron limpiar sesiones:', error));
});

function cerrar(senal: string): void {
  console.log(`Recibido ${senal}; cerrando servidor...`);
  servidor.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => cerrar('SIGINT'));
process.on('SIGTERM', () => cerrar('SIGTERM'));

export { app };
