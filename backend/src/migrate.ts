import { pool } from './db.js';

async function tablaExiste(nombre: string): Promise<boolean> {
  const [rows]: any = await pool.query(
    `SELECT COUNT(*) AS total FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [nombre]
  );
  return Number(rows[0].total) > 0;
}

async function columnaExiste(tabla: string, columna: string): Promise<boolean> {
  const [rows]: any = await pool.query(
    `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabla, columna]
  );
  return Number(rows[0].total) > 0;
}

async function agregarColumna(tabla: string, columna: string, definicion: string): Promise<void> {
  if (await columnaExiste(tabla, columna)) return;
  await pool.query(`ALTER TABLE \`${tabla}\` ADD COLUMN \`${columna}\` ${definicion}`);
  console.log(`  + ${tabla}.${columna}`);
}

async function agregarIndice(tabla: string, indice: string, columnas: string): Promise<void> {
  const [rows]: any = await pool.query(
    `SELECT COUNT(*) AS total FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tabla, indice]
  );
  if (Number(rows[0].total) > 0) return;
  await pool.query(`ALTER TABLE \`${tabla}\` ADD INDEX \`${indice}\` (${columnas})`);
  console.log(`  + índice ${tabla}.${indice}`);
}

async function agregarColumnasSync(tabla: string): Promise<void> {
  await agregarColumna(tabla, 'version', 'INT NOT NULL DEFAULT 1');
  await agregarColumna(tabla, 'deleted_at', 'DATETIME NULL');
}

async function agregarColumnasDocumento(tabla: string): Promise<void> {
  await agregarColumna(tabla, 'usuario_id', 'CHAR(36) NULL');
  await agregarColumna(tabla, 'estado', "ENUM('activa','anulada') NOT NULL DEFAULT 'activa'");
  await agregarColumna(tabla, 'anulada_en', 'DATETIME NULL');
  await agregarColumna(tabla, 'anulada_por', 'CHAR(36) NULL');
  await agregarColumna(tabla, 'version', 'INT NOT NULL DEFAULT 1');
  await agregarColumna(tabla, 'deleted_at', 'DATETIME NULL');
  await agregarIndice(tabla, `idx_${tabla}_estado`, 'estado');
  await agregarIndice(tabla, `idx_${tabla}_usuario`, 'usuario_id');
}

async function crearTablas(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS movimientos_inventario (
      id CHAR(36) NOT NULL PRIMARY KEY,
      tipo ENUM('venta','compra','ajuste','anulacion_venta','anulacion_compra') NOT NULL,
      talla_id CHAR(36) NULL,
      materia_prima_id CHAR(36) NULL,
      cantidad DECIMAL(10,2) NOT NULL,
      stock_resultante DECIMAL(10,2) NOT NULL,
      referencia_id CHAR(36) NULL,
      usuario_id CHAR(36) NOT NULL,
      dispositivo_id CHAR(36) NULL,
      fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_mov_talla (talla_id),
      INDEX idx_mov_material (materia_prima_id),
      INDEX idx_mov_referencia (referencia_id),
      INDEX idx_mov_fecha (fecha),
      CONSTRAINT fk_mov_talla FOREIGN KEY (talla_id) REFERENCES tallas(id),
      CONSTRAINT fk_mov_material FOREIGN KEY (materia_prima_id) REFERENCES materia_prima(id),
      CONSTRAINT fk_mov_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  + tabla movimientos_inventario (si no existía)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id CHAR(36) NOT NULL PRIMARY KEY,
      usuario_id CHAR(36) NOT NULL,
      dispositivo_id CHAR(36) NULL,
      entidad VARCHAR(40) NOT NULL,
      entidad_id CHAR(36) NOT NULL,
      accion VARCHAR(40) NOT NULL,
      antes_json JSON NULL,
      despues_json JSON NULL,
      fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_aud_entidad (entidad, entidad_id),
      INDEX idx_aud_fecha (fecha),
      INDEX idx_aud_usuario (usuario_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  + tabla auditoria (si no existía)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_cambios (
      seq BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      entidad VARCHAR(40) NOT NULL,
      entidad_id CHAR(36) NOT NULL,
      operacion ENUM('upsert','delete') NOT NULL,
      payload JSON NOT NULL,
      usuario_id CHAR(36) NULL,
      dispositivo_id CHAR(36) NULL,
      fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sync_seq (seq),
      INDEX idx_sync_entidad (entidad, entidad_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  + tabla sync_cambios (si no existía)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dispositivos (
      id CHAR(36) NOT NULL PRIMARY KEY,
      nombre VARCHAR(80) NOT NULL,
      usuario_id CHAR(36) NULL,
      ultimo_sync DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_disp_usuario (usuario_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  + tabla dispositivos (si no existía)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_recibidos (
      idempotency_key VARCHAR(100) NOT NULL PRIMARY KEY,
      entidad VARCHAR(40) NOT NULL,
      entidad_id CHAR(36) NOT NULL,
      usuario_id CHAR(36) NULL,
      dispositivo_id CHAR(36) NULL,
      recibido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  + tabla sync_recibidos (si no existía)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS producto_costos (
      id CHAR(36) NOT NULL PRIMARY KEY,
      producto_id CHAR(36) NOT NULL,
      costo DECIMAL(10,2) NOT NULL,
      vigente_desde DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      usuario_id CHAR(36) NULL,
      dispositivo_id CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pc_producto (producto_id, vigente_desde),
      CONSTRAINT fk_pc_producto FOREIGN KEY (producto_id) REFERENCES productos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  + tabla producto_costos (si no existía)');
}

export async function migrar(): Promise<void> {
  console.log('Migrando esquema de Varano...');

  await agregarColumnasDocumento('ventas');
  await agregarColumnasDocumento('compras');

  for (const tabla of ['productos', 'tallas', 'clientes', 'proveedores', 'materia_prima']) {
    await agregarColumnasSync(tabla);
  }

  // Costo vigente por par del modelo y su instantánea en cada línea de venta.
  await agregarColumna('productos', 'costo_base', 'DECIMAL(10,2) NOT NULL DEFAULT 0');
  await agregarColumna('venta_detalle', 'costo_unitario', 'DECIMAL(10,2) NOT NULL DEFAULT 0');

  await crearTablas();

  // Índices útiles para pull y para búsquedas del negocio.
  await agregarIndice('tallas', 'idx_tallas_producto', 'producto_id');
  await agregarIndice('ventas', 'idx_ventas_fecha', 'fecha');
  await agregarIndice('compras', 'idx_compras_fecha', 'fecha');
  await agregarIndice('venta_detalle', 'idx_vd_venta', 'venta_id');
  await agregarIndice('compra_detalle', 'idx_cd_compra', 'compra_id');

  console.log('Migración terminada.');
}

const ejecutadoDirecto = process.argv[1]?.replace(/\\/g, '/').endsWith('/migrate.ts');
if (ejecutadoDirecto) {
  migrar()
    .then(async () => { await pool.end(); process.exit(0); })
    .catch(async error => {
      console.error('Error en la migración:', error);
      await pool.end();
      process.exit(1);
    });
}
