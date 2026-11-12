import crypto from 'node:crypto';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { conTransaccion } from '../db.js';
import { ConflictoError, ValidacionError } from '../errors.js';
import { auditar, registrarCambio } from '../auditoria.js';
import {
  ajusteStockMaterialSchema,
  ajusteStockSchema,
  clienteSchema,
  compraSchema,
  materialSchema,
  productoCostoSchema,
  productoSchema,
  proveedorSchema,
  tallaSchema,
  ventaSchema,
  type Advertencia,
  type CambioRecibido,
  type ResultadoCambio
} from './types.js';

type Fila = Record<string, any>;

/**
 * Entidades que solo un administrador puede modificar. El frontend ya oculta
 * estas acciones al usuario normal, pero el servidor no debe confiar en eso.
 */
const ENTIDADES_SOLO_ADMIN = new Set<string>([
  'producto',
  'producto_costo',
  'talla',
  'proveedor',
  'materia_prima',
  'compra',
  'ajuste_stock',
  'ajuste_stock_material'
]);

/** Una venta anulada o corregida solo la puede enviar un administrador. */
function ventaRequiereAdmin(cambio: CambioRecibido): boolean {
  if (cambio.entidad !== 'venta') return false;
  const p = cambio.payload as Record<string, unknown> | null;
  return p?.estado === 'anulada' || p?.correccion === true;
}

function motivoSoloAdmin(cambio: CambioRecibido): string {
  if (cambio.entidad === 'venta') return 'Anular o corregir ventas es solo para administradores.';
  if (cambio.entidad === 'compra') return 'Registrar o anular compras es solo para administradores.';
  if (cambio.entidad === 'talla' || cambio.entidad === 'ajuste_stock') return 'Modificar el inventario es solo para administradores.';
  if (cambio.entidad === 'producto' || cambio.entidad === 'producto_costo') return 'Modificar modelos o costos es solo para administradores.';
  return 'Esta acción es solo para administradores.';
}


function fechaMysql(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function numero(valor: unknown): number {
  return Number(valor ?? 0);
}

function texto(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  const v = String(valor);
  return v.length ? v : null;
}

/** Costo vigente del modelo al que pertenece una talla (respaldo para clientes antiguos). */
async function costoDeTalla(conn: PoolConnection, tallaId: string): Promise<number> {
  const r = await fila(conn,
    `SELECT p.costo_base
       FROM tallas t
       JOIN productos p ON p.id = t.producto_id
      WHERE t.id = ?`,
    [tallaId]
  );
  return numero(r?.costo_base);
}

async function fila(conn: PoolConnection, sql: string, valores: unknown[] = []): Promise<Fila | undefined> {
  const [rows]: any = await conn.query(sql, valores);
  return rows[0] as Fila | undefined;
}

async function filas(conn: PoolConnection, sql: string, valores: unknown[] = []): Promise<Fila[]> {
  const [rows]: any = await conn.query(sql, valores);
  return rows as Fila[];
}

async function ejecutar(conn: PoolConnection, sql: string, valores: unknown[] = []): Promise<ResultSetHeader> {
  const [resultado] = await conn.query(sql, valores);
  return resultado as ResultSetHeader;
}

/** Procesa una venta nueva o su anulación. */
async function procesarVenta(
  conn: PoolConnection,
  cambio: CambioRecibido,
  usuarioId: string,
  dispositivoId: string | null
): Promise<ResultadoCambio> {
  const datos = ventaSchema.parse(cambio.payload);
  const existente = await fila(conn, 'SELECT id, estado, version FROM ventas WHERE id = ? FOR UPDATE', [datos.id]);

  if (existente) {
    if (datos.correccion && existente.estado === 'activa') {
      return corregirVenta(conn, cambio, datos, usuarioId, dispositivoId);
    }
    const quiereAnular = datos.estado === 'anulada';
    if (!quiereAnular || existente.estado === 'anulada') {
      return { ...base(cambio), estado: 'duplicado', mensaje: 'La venta ya existe.' };
    }

    const detalles = await filas(conn, 'SELECT talla_id, cantidad FROM venta_detalle WHERE venta_id = ?', [datos.id]);
    const advertencias: Advertencia[] = [];
    const tallasAfectadas = new Set<string>();
    for (const d of detalles) {
      tallasAfectadas.add(d.talla_id);
      await ejecutar(conn, 'UPDATE tallas SET stock = stock + ?, updated_at = NOW() WHERE id = ?', [numero(d.cantidad), d.talla_id]);
      const t = await fila(conn, 'SELECT stock FROM tallas WHERE id = ?', [d.talla_id]);
      await ejecutar(conn,
        `INSERT INTO movimientos_inventario
           (id, tipo, talla_id, cantidad, stock_resultante, referencia_id, usuario_id, dispositivo_id, fecha)
         VALUES (?, 'anulacion_venta', ?, ?, ?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), d.talla_id, numero(d.cantidad), numero(t?.stock), datos.id, usuarioId, dispositivoId]
      );
      if (numero(t?.stock) < 0) {
        advertencias.push({ tipo: 'stock_negativo', talla_id: d.talla_id, stock_resultante: numero(t?.stock) });
      }
    }

    await ejecutar(conn,
      `UPDATE ventas
          SET estado = 'anulada', anulada_en = NOW(), anulada_por = ?, version = version + 1, updated_at = NOW()
        WHERE id = ?`,
      [usuarioId, datos.id]
    );
    await auditar(conn, {
      usuarioId, dispositivoId, entidad: 'venta', entidadId: datos.id, accion: 'anular_venta',
      antes: { estado: existente.estado }, despues: { estado: 'anulada' }
    });
    const seq = await registrarCambio(conn, {
      entidad: 'venta', entidadId: datos.id, operacion: 'upsert',
      payload: await payloadVenta(conn, datos.id), usuarioId, dispositivoId
    });
    for (const tallaId of tallasAfectadas) {
      await registrarCambioTalla(conn, tallaId, usuarioId, dispositivoId);
    }
    return { ...base(cambio), estado: 'aplicado', advertencias, seq };
  }

  if (datos.estado === 'anulada') {
    throw new ConflictoError('No se puede anular una venta que el servidor no conoce.');
  }
  if (!datos.detalles?.length) {
    throw new ValidacionError('La venta no tiene líneas de detalle.');
  }

  await ejecutar(conn,
    `INSERT INTO ventas (id, cliente_id, fecha, total, usuario_id, estado, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'activa', 1, NOW(), NOW())`,
    [datos.id, datos.cliente_id, fechaMysql(datos.fecha) ?? new Date(), datos.total, usuarioId]
  );

  const advertencias: Advertencia[] = [];
  const tallasAfectadas = new Set<string>();
  for (const d of datos.detalles) {
    tallasAfectadas.add(d.talla_id);
    const costo = d.costo_unitario ?? await costoDeTalla(conn, d.talla_id);
    await ejecutar(conn,
      `INSERT INTO venta_detalle (id, venta_id, talla_id, cantidad, precio_unitario, costo_unitario)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [d.id, datos.id, d.talla_id, d.cantidad, d.precio_unitario, costo]
    );

    const actualizada = await ejecutar(conn,
      'UPDATE tallas SET stock = stock - ?, updated_at = NOW() WHERE id = ?',
      [d.cantidad, d.talla_id]
    );
    if (actualizada.affectedRows === 0) {
      throw new ValidacionError(`La talla ${d.talla_id} no existe en el servidor.`);
    }
    const t = await fila(conn, 'SELECT stock FROM tallas WHERE id = ?', [d.talla_id]);
    const stock = numero(t?.stock);
    await ejecutar(conn,
      `INSERT INTO movimientos_inventario
         (id, tipo, talla_id, cantidad, stock_resultante, referencia_id, usuario_id, dispositivo_id, fecha)
       VALUES (?, 'venta', ?, ?, ?, ?, ?, ?, NOW())`,
      [crypto.randomUUID(), d.talla_id, -d.cantidad, stock, datos.id, usuarioId, dispositivoId]
    );
    if (stock < 0) {
      advertencias.push({ tipo: 'stock_negativo', talla_id: d.talla_id, stock_resultante: stock });
    }
  }

  await auditar(conn, {
    usuarioId, dispositivoId, entidad: 'venta', entidadId: datos.id, accion: 'crear_venta',
    despues: { cliente_id: datos.cliente_id, total: datos.total, detalles: datos.detalles.length }
  });
  const seq = await registrarCambio(conn, {
    entidad: 'venta', entidadId: datos.id, operacion: 'upsert',
    payload: await payloadVenta(conn, datos.id), usuarioId, dispositivoId
  });
  for (const tallaId of tallasAfectadas) {
    await registrarCambioTalla(conn, tallaId, usuarioId, dispositivoId);
  }
  return { ...base(cambio), estado: 'aplicado', advertencias, seq };
}

/** Corrige una venta existente: ajusta stock por diferencias y reemplaza líneas. */
async function corregirVenta(
  conn: PoolConnection,
  cambio: CambioRecibido,
  datos: any,
  usuarioId: string,
  dispositivoId: string | null
): Promise<ResultadoCambio> {
  if (!datos.detalles?.length) {
    throw new ValidacionError('La corrección no tiene líneas de detalle.');
  }

  const actuales = await filas(conn, 'SELECT talla_id, cantidad FROM venta_detalle WHERE venta_id = ?', [datos.id]);
  const antes = new Map<string, number>();
  const despues = new Map<string, number>();
  for (const d of actuales) antes.set(d.talla_id, (antes.get(d.talla_id) ?? 0) + numero(d.cantidad));
  for (const d of datos.detalles) despues.set(d.talla_id, (despues.get(d.talla_id) ?? 0) + numero(d.cantidad));

  const advertencias: Advertencia[] = [];
  const tallasAfectadas = new Set<string>([...antes.keys(), ...despues.keys()]);
  for (const tallaId of tallasAfectadas) {
    const delta = (despues.get(tallaId) ?? 0) - (antes.get(tallaId) ?? 0);
    if (delta === 0) continue;

    const actualizada = await ejecutar(conn,
      'UPDATE tallas SET stock = stock - ?, updated_at = NOW() WHERE id = ?',
      [delta, tallaId]
    );
    if (actualizada.affectedRows === 0) {
      throw new ValidacionError(`La talla ${tallaId} no existe en el servidor.`);
    }
    const t = await fila(conn, 'SELECT stock FROM tallas WHERE id = ?', [tallaId]);
    const stock = numero(t?.stock);
    await ejecutar(conn,
      `INSERT INTO movimientos_inventario
         (id, tipo, talla_id, cantidad, stock_resultante, referencia_id, usuario_id, dispositivo_id, fecha)
       VALUES (?, 'ajuste', ?, ?, ?, ?, ?, ?, NOW())`,
      [crypto.randomUUID(), tallaId, -delta, stock, datos.id, usuarioId, dispositivoId]
    );
    if (stock < 0) {
      advertencias.push({ tipo: 'stock_negativo', talla_id: tallaId, stock_resultante: stock });
    }
  }

  await ejecutar(conn, 'DELETE FROM venta_detalle WHERE venta_id = ?', [datos.id]);
  for (const d of datos.detalles) {
    const costo = d.costo_unitario ?? await costoDeTalla(conn, d.talla_id);
    await ejecutar(conn,
      `INSERT INTO venta_detalle (id, venta_id, talla_id, cantidad, precio_unitario, costo_unitario)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [d.id, datos.id, d.talla_id, d.cantidad, d.precio_unitario, costo]
    );
  }
  await ejecutar(conn,
    `UPDATE ventas
        SET cliente_id = ?, fecha = ?, total = ?, version = version + 1, updated_at = NOW()
      WHERE id = ?`,
    [datos.cliente_id, fechaMysql(datos.fecha) ?? new Date(), datos.total, datos.id]
  );

  await auditar(conn, {
    usuarioId, dispositivoId, entidad: 'venta', entidadId: datos.id, accion: 'corregir_venta',
    antes: { detalles: actuales.length }, despues: { total: datos.total, detalles: datos.detalles.length }
  });
  const seq = await registrarCambio(conn, {
    entidad: 'venta', entidadId: datos.id, operacion: 'upsert',
    payload: await payloadVenta(conn, datos.id), usuarioId, dispositivoId
  });
  for (const tallaId of tallasAfectadas) {
    await registrarCambioTalla(conn, tallaId, usuarioId, dispositivoId);
  }
  return { ...base(cambio), estado: 'aplicado', advertencias, seq };
}

/** Procesa una compra nueva o su anulación. */
async function procesarCompra(
  conn: PoolConnection,
  cambio: CambioRecibido,
  usuarioId: string,
  dispositivoId: string | null
): Promise<ResultadoCambio> {
  const datos = compraSchema.parse(cambio.payload);
  const existente = await fila(conn, 'SELECT id, estado FROM compras WHERE id = ? FOR UPDATE', [datos.id]);

  if (existente) {
    const quiereAnular = datos.estado === 'anulada';
    if (!quiereAnular || existente.estado === 'anulada') {
      return { ...base(cambio), estado: 'duplicado', mensaje: 'La compra ya existe.' };
    }

    const detalles = await filas(conn, 'SELECT materia_prima_id, cantidad FROM compra_detalle WHERE compra_id = ?', [datos.id]);
    const materialesAfectados = new Set<string>();
    for (const d of detalles) {
      materialesAfectados.add(d.materia_prima_id);
      const m = await fila(conn, 'SELECT stock, nombre FROM materia_prima WHERE id = ? FOR UPDATE', [d.materia_prima_id]);
      if (!m) throw new ValidacionError('El material de la compra no existe.');
      if (numero(m.stock) < numero(d.cantidad)) {
        throw new ConflictoError(`No se puede anular la compra: "${m.nombre}" ya no tiene existencia suficiente.`);
      }
    }
    for (const d of detalles) {
      await ejecutar(conn, 'UPDATE materia_prima SET stock = stock - ?, updated_at = NOW() WHERE id = ?', [numero(d.cantidad), d.materia_prima_id]);
      const m = await fila(conn, 'SELECT stock FROM materia_prima WHERE id = ?', [d.materia_prima_id]);
      await ejecutar(conn,
        `INSERT INTO movimientos_inventario
           (id, tipo, materia_prima_id, cantidad, stock_resultante, referencia_id, usuario_id, dispositivo_id, fecha)
         VALUES (?, 'anulacion_compra', ?, ?, ?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), d.materia_prima_id, -numero(d.cantidad), numero(m?.stock), datos.id, usuarioId, dispositivoId]
      );
    }

    await ejecutar(conn,
      `UPDATE compras
          SET estado = 'anulada', anulada_en = NOW(), anulada_por = ?, version = version + 1, updated_at = NOW()
        WHERE id = ?`,
      [usuarioId, datos.id]
    );
    await auditar(conn, {
      usuarioId, dispositivoId, entidad: 'compra', entidadId: datos.id, accion: 'anular_compra',
      antes: { estado: existente.estado }, despues: { estado: 'anulada' }
    });
    const seq = await registrarCambio(conn, {
      entidad: 'compra', entidadId: datos.id, operacion: 'upsert',
      payload: await payloadCompra(conn, datos.id), usuarioId, dispositivoId
    });
    for (const materialId of materialesAfectados) {
      await registrarCambioMaterial(conn, materialId, usuarioId, dispositivoId);
    }
    return { ...base(cambio), estado: 'aplicado', seq };
  }

  if (datos.estado === 'anulada') {
    throw new ConflictoError('No se puede anular una compra que el servidor no conoce.');
  }
  if (!datos.detalles?.length) {
    throw new ValidacionError('La compra no tiene líneas de detalle.');
  }

  await ejecutar(conn,
    `INSERT INTO compras (id, proveedor_id, fecha, total, usuario_id, estado, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'activa', 1, NOW(), NOW())`,
    [datos.id, datos.proveedor_id, fechaMysql(datos.fecha) ?? new Date(), datos.total, usuarioId]
  );

  const materialesAfectados = new Set<string>();
  for (const d of datos.detalles) {
    materialesAfectados.add(d.materia_prima_id);
    await ejecutar(conn,
      `INSERT INTO compra_detalle (id, compra_id, materia_prima_id, cantidad, precio_unitario)
       VALUES (?, ?, ?, ?, ?)`,
      [d.id, datos.id, d.materia_prima_id, d.cantidad, d.precio_unitario]
    );
    const actualizada = await ejecutar(conn,
      'UPDATE materia_prima SET stock = stock + ?, updated_at = NOW() WHERE id = ?',
      [d.cantidad, d.materia_prima_id]
    );
    if (actualizada.affectedRows === 0) {
      throw new ValidacionError(`El material ${d.materia_prima_id} no existe en el servidor.`);
    }
    const m = await fila(conn, 'SELECT stock FROM materia_prima WHERE id = ?', [d.materia_prima_id]);
    await ejecutar(conn,
      `INSERT INTO movimientos_inventario
         (id, tipo, materia_prima_id, cantidad, stock_resultante, referencia_id, usuario_id, dispositivo_id, fecha)
       VALUES (?, 'compra', ?, ?, ?, ?, ?, ?, NOW())`,
      [crypto.randomUUID(), d.materia_prima_id, d.cantidad, numero(m?.stock), datos.id, usuarioId, dispositivoId]
    );
  }

  await auditar(conn, {
    usuarioId, dispositivoId, entidad: 'compra', entidadId: datos.id, accion: 'crear_compra',
    despues: { proveedor_id: datos.proveedor_id, total: datos.total, detalles: datos.detalles.length }
  });
  const seq = await registrarCambio(conn, {
    entidad: 'compra', entidadId: datos.id, operacion: 'upsert',
    payload: await payloadCompra(conn, datos.id), usuarioId, dispositivoId
  });
  for (const materialId of materialesAfectados) {
    await registrarCambioMaterial(conn, materialId, usuarioId, dispositivoId);
  }
  return { ...base(cambio), estado: 'aplicado', seq };
}

async function payloadVenta(conn: PoolConnection, id: string): Promise<unknown> {
  const v = await fila(conn, 'SELECT * FROM ventas WHERE id = ?', [id]);
  if (!v) return { id };
  const detalles = await filas(conn, 'SELECT * FROM venta_detalle WHERE venta_id = ?', [id]);
  return {
    id: v.id,
    cliente_id: v.cliente_id,
    fecha: v.fecha,
    total: numero(v.total),
    usuario_id: v.usuario_id,
    estado: v.estado,
    anulada_en: v.anulada_en,
    anulada_por: v.anulada_por,
    version: numero(v.version),
    deleted_at: v.deleted_at,
    detalles: detalles.map(d => ({
      id: d.id, talla_id: d.talla_id, cantidad: numero(d.cantidad),
      precio_unitario: numero(d.precio_unitario), costo_unitario: numero(d.costo_unitario)
    }))
  };
}

async function payloadCompra(conn: PoolConnection, id: string): Promise<unknown> {
  const c = await fila(conn, 'SELECT * FROM compras WHERE id = ?', [id]);
  if (!c) return { id };
  const detalles = await filas(conn, 'SELECT * FROM compra_detalle WHERE compra_id = ?', [id]);
  return {
    id: c.id,
    proveedor_id: c.proveedor_id,
    fecha: c.fecha,
    total: numero(c.total),
    usuario_id: c.usuario_id,
    estado: c.estado,
    anulada_en: c.anulada_en,
    anulada_por: c.anulada_por,
    version: numero(c.version),
    deleted_at: c.deleted_at,
    detalles: detalles.map(d => ({
      id: d.id, materia_prima_id: d.materia_prima_id, cantidad: numero(d.cantidad), precio_unitario: numero(d.precio_unitario)
    }))
  };
}

function base(cambio: CambioRecibido): Omit<ResultadoCambio, 'estado'> {
  return { id: cambio.id, entidad: cambio.entidad, entidad_id: cambio.entidad_id };
}

/** Catálogos: upsert idempotente y borrado lógico. */
async function procesarCatalogo(
  conn: PoolConnection,
  cambio: CambioRecibido,
  usuarioId: string,
  dispositivoId: string | null
): Promise<ResultadoCambio> {
  if (cambio.operacion === 'delete') {
    const tabla = tablaDeEntidad(cambio.entidad);
    if (!tabla) throw new ValidacionError('Entidad no válida para borrar.');
    const resultado = await ejecutar(conn,
      `UPDATE \`${tabla}\` SET deleted_at = NOW(), version = version + 1, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
      [cambio.entidad_id]
    );
    if (resultado.affectedRows === 0) {
      return { ...base(cambio), estado: 'duplicado', mensaje: 'El registro ya no existe o ya fue eliminado.' };
    }
    await auditar(conn, {
      usuarioId, dispositivoId, entidad: cambio.entidad, entidadId: cambio.entidad_id,
      accion: 'eliminar', despues: { deleted_at: new Date().toISOString() }
    });
    const seq = await registrarCambio(conn, {
      entidad: cambio.entidad, entidadId: cambio.entidad_id, operacion: 'delete',
      payload: { id: cambio.entidad_id, deleted_at: new Date().toISOString() },
      usuarioId, dispositivoId
    });
    return { ...base(cambio), estado: 'aplicado', seq };
  }

  switch (cambio.entidad) {
    case 'cliente': return upsertCliente(conn, cambio, usuarioId, dispositivoId);
    case 'producto': return upsertProducto(conn, cambio, usuarioId, dispositivoId);
    case 'producto_costo': return upsertProductoCosto(conn, cambio, usuarioId, dispositivoId);
    case 'talla': return upsertTalla(conn, cambio, usuarioId, dispositivoId);
    case 'proveedor': return upsertProveedor(conn, cambio, usuarioId, dispositivoId);
    case 'materia_prima': return upsertMaterial(conn, cambio, usuarioId, dispositivoId);
    default: throw new ValidacionError('Entidad no válida.');
  }
}

async function upsertCliente(conn: PoolConnection, cambio: CambioRecibido, usuarioId: string, dispositivoId: string | null): Promise<ResultadoCambio> {
  const d = clienteSchema.parse(cambio.payload);
  await ejecutar(conn,
    `INSERT INTO clientes (id, nombre, apellido, telefono, direccion, created_at, updated_at, deleted_at, version)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, NOW()), NOW(), ?, 1)
     ON DUPLICATE KEY UPDATE
       nombre = VALUES(nombre), apellido = VALUES(apellido), telefono = VALUES(telefono),
       direccion = VALUES(direccion), deleted_at = VALUES(deleted_at), version = version + 1, updated_at = NOW()`,
    [d.id, d.nombre, texto(d.apellido), texto(d.telefono), texto(d.direccion), fechaMysql(d.created_at), fechaMysql(d.deleted_at)]
  );
  return registrarCatalogo(conn, cambio, 'cliente', d.id, usuarioId, dispositivoId, 'guardar_cliente');
}

async function upsertProducto(conn: PoolConnection, cambio: CambioRecibido, usuarioId: string, dispositivoId: string | null): Promise<ResultadoCambio> {
  const d = productoSchema.parse(cambio.payload);
  const existente = await fila(conn, 'SELECT id, costo_base FROM productos WHERE id = ?', [d.id]);
  if (existente) {
    // Si un cliente antiguo no manda costo_base, se conserva el vigente.
    const costo = d.costo_base ?? numero(existente.costo_base);
    await ejecutar(conn,
      `UPDATE productos
          SET modelo = ?, precio_base = ?, costo_base = ?, deleted_at = ?,
              version = version + 1, updated_at = NOW()
        WHERE id = ?`,
      [d.modelo, d.precio_base, costo, fechaMysql(d.deleted_at), d.id]
    );
  } else {
    await ejecutar(conn,
      `INSERT INTO productos (id, modelo, precio_base, costo_base, created_at, updated_at, deleted_at, version)
       VALUES (?, ?, ?, ?, COALESCE(?, NOW()), NOW(), ?, 1)`,
      [d.id, d.modelo, d.precio_base, d.costo_base ?? 0, fechaMysql(d.created_at), fechaMysql(d.deleted_at)]
    );
  }
  return registrarCatalogo(conn, cambio, 'producto', d.id, usuarioId, dispositivoId, 'guardar_producto');
}

async function upsertProductoCosto(conn: PoolConnection, cambio: CambioRecibido, usuarioId: string, dispositivoId: string | null): Promise<ResultadoCambio> {
  const d = productoCostoSchema.parse(cambio.payload);
  await ejecutar(conn,
    `INSERT INTO producto_costos
       (id, producto_id, costo, vigente_desde, usuario_id, dispositivo_id, created_at)
     VALUES (?, ?, ?, COALESCE(?, NOW()), ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       costo = VALUES(costo), vigente_desde = VALUES(vigente_desde)`,
    [d.id, d.producto_id, d.costo, fechaMysql(d.vigente_desde), usuarioId, dispositivoId]
  );
  return registrarCatalogo(conn, cambio, 'producto_costo', d.id, usuarioId, dispositivoId, 'guardar_costo_producto');
}

async function upsertTalla(conn: PoolConnection, cambio: CambioRecibido, usuarioId: string, dispositivoId: string | null): Promise<ResultadoCambio> {
  const d = tallaSchema.parse(cambio.payload);
  const existente = await fila(conn, 'SELECT id FROM tallas WHERE id = ?', [d.id]);
  if (existente) {
    await ejecutar(conn,
      `UPDATE tallas SET producto_id = ?, talla = ?, deleted_at = ?, version = version + 1, updated_at = NOW()
        WHERE id = ?`,
      [d.producto_id, d.talla, fechaMysql(d.deleted_at), d.id]
    );
  } else {
    await ejecutar(conn,
      `INSERT INTO tallas (id, producto_id, talla, stock, created_at, updated_at, deleted_at, version)
       VALUES (?, ?, ?, ?, COALESCE(?, NOW()), NOW(), ?, 1)`,
      [d.id, d.producto_id, d.talla, d.stock ?? 0, fechaMysql(d.created_at), fechaMysql(d.deleted_at)]
    );
    if ((d.stock ?? 0) !== 0) {
      await ejecutar(conn,
        `INSERT INTO movimientos_inventario
           (id, tipo, talla_id, cantidad, stock_resultante, usuario_id, dispositivo_id, fecha)
         VALUES (?, 'ajuste', ?, ?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), d.id, d.stock ?? 0, d.stock ?? 0, usuarioId, dispositivoId]
      );
    }
  }
  return registrarCatalogo(conn, cambio, 'talla', d.id, usuarioId, dispositivoId, 'guardar_talla');
}

async function upsertProveedor(conn: PoolConnection, cambio: CambioRecibido, usuarioId: string, dispositivoId: string | null): Promise<ResultadoCambio> {
  const d = proveedorSchema.parse(cambio.payload);
  await ejecutar(conn,
    `INSERT INTO proveedores (id, nombre, telefono, direccion, correo, created_at, updated_at, deleted_at, version)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, NOW()), NOW(), ?, 1)
     ON DUPLICATE KEY UPDATE
       nombre = VALUES(nombre), telefono = VALUES(telefono), direccion = VALUES(direccion),
       correo = VALUES(correo), deleted_at = VALUES(deleted_at), version = version + 1, updated_at = NOW()`,
    [d.id, d.nombre, texto(d.telefono), texto(d.direccion), texto(d.correo), fechaMysql(d.created_at), fechaMysql(d.deleted_at)]
  );
  return registrarCatalogo(conn, cambio, 'proveedor', d.id, usuarioId, dispositivoId, 'guardar_proveedor');
}

async function upsertMaterial(conn: PoolConnection, cambio: CambioRecibido, usuarioId: string, dispositivoId: string | null): Promise<ResultadoCambio> {
  const d = materialSchema.parse(cambio.payload);
  const existente = await fila(conn, 'SELECT id FROM materia_prima WHERE id = ?', [d.id]);
  if (existente) {
    await ejecutar(conn,
      `UPDATE materia_prima SET nombre = ?, categoria = ?, precio = ?, deleted_at = ?,
              version = version + 1, updated_at = NOW()
        WHERE id = ?`,
      [d.nombre, texto(d.categoria), d.precio, fechaMysql(d.deleted_at), d.id]
    );
  } else {
    await ejecutar(conn,
      `INSERT INTO materia_prima (id, nombre, categoria, precio, stock, created_at, updated_at, deleted_at, version)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, NOW()), NOW(), ?, 1)`,
      [d.id, d.nombre, texto(d.categoria), d.precio, d.stock ?? 0, fechaMysql(d.created_at), fechaMysql(d.deleted_at)]
    );
    if ((d.stock ?? 0) !== 0) {
      await ejecutar(conn,
        `INSERT INTO movimientos_inventario
           (id, tipo, materia_prima_id, cantidad, stock_resultante, usuario_id, dispositivo_id, fecha)
         VALUES (?, 'ajuste', ?, ?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), d.id, d.stock ?? 0, d.stock ?? 0, usuarioId, dispositivoId]
      );
    }
  }
  return registrarCatalogo(conn, cambio, 'materia_prima', d.id, usuarioId, dispositivoId, 'guardar_material');
}

async function registrarCatalogo(
  conn: PoolConnection,
  cambio: CambioRecibido,
  entidad: string,
  entidadId: string,
  usuarioId: string,
  dispositivoId: string | null,
  accion: string
): Promise<ResultadoCambio> {
  await auditar(conn, { usuarioId, dispositivoId, entidad, entidadId, accion, despues: cambio.payload });
  const seq = await registrarCambio(conn, {
    entidad, entidadId, operacion: 'upsert', payload: cambio.payload, usuarioId, dispositivoId
  });
  return { ...base(cambio), estado: 'aplicado', seq };
}

async function procesarAjusteStock(
  conn: PoolConnection,
  cambio: CambioRecibido,
  usuarioId: string,
  dispositivoId: string | null
): Promise<ResultadoCambio> {
  const d = ajusteStockSchema.parse(cambio.payload);
  const t = await fila(conn, 'SELECT stock FROM tallas WHERE id = ? FOR UPDATE', [d.talla_id]);
  if (!t) throw new ValidacionError('La talla no existe en el servidor.');
  const anterior = numero(t.stock);
  const delta = d.stock - anterior;
  await ejecutar(conn, 'UPDATE tallas SET stock = ?, version = version + 1, updated_at = NOW() WHERE id = ?', [d.stock, d.talla_id]);
  await ejecutar(conn,
    `INSERT INTO movimientos_inventario
       (id, tipo, talla_id, cantidad, stock_resultante, usuario_id, dispositivo_id, fecha)
     VALUES (?, 'ajuste', ?, ?, ?, ?, ?, NOW())`,
    [crypto.randomUUID(), d.talla_id, delta, d.stock, usuarioId, dispositivoId]
  );
  await auditar(conn, {
    usuarioId, dispositivoId, entidad: 'talla', entidadId: d.talla_id, accion: 'ajustar_stock',
    antes: { stock: anterior }, despues: { stock: d.stock, motivo: d.motivo }
  });
  const filaTalla = await fila(conn, 'SELECT * FROM tallas WHERE id = ?', [d.talla_id]);
  const payload = {
    id: filaTalla!.id, producto_id: filaTalla!.producto_id, talla: numero(filaTalla!.talla),
    stock: numero(filaTalla!.stock), version: numero(filaTalla!.version),
    updated_at: filaTalla!.updated_at, deleted_at: filaTalla!.deleted_at
  };
  const seq = await registrarCambio(conn, {
    entidad: 'talla', entidadId: d.talla_id, operacion: 'upsert', payload, usuarioId, dispositivoId
  });
  return { ...base(cambio), estado: 'aplicado', seq };
}

async function procesarAjusteMaterial(
  conn: PoolConnection,
  cambio: CambioRecibido,
  usuarioId: string,
  dispositivoId: string | null
): Promise<ResultadoCambio> {
  const d = ajusteStockMaterialSchema.parse(cambio.payload);
  const m = await fila(conn, 'SELECT stock FROM materia_prima WHERE id = ? FOR UPDATE', [d.materia_prima_id]);
  if (!m) throw new ValidacionError('El material no existe en el servidor.');
  const anterior = numero(m.stock);
  const delta = d.stock - anterior;
  await ejecutar(conn, 'UPDATE materia_prima SET stock = ?, version = version + 1, updated_at = NOW() WHERE id = ?', [d.stock, d.materia_prima_id]);
  await ejecutar(conn,
    `INSERT INTO movimientos_inventario
       (id, tipo, materia_prima_id, cantidad, stock_resultante, usuario_id, dispositivo_id, fecha)
     VALUES (?, 'ajuste', ?, ?, ?, ?, ?, NOW())`,
    [crypto.randomUUID(), d.materia_prima_id, delta, d.stock, usuarioId, dispositivoId]
  );
  await auditar(conn, {
    usuarioId, dispositivoId, entidad: 'materia_prima', entidadId: d.materia_prima_id, accion: 'ajustar_stock',
    antes: { stock: anterior }, despues: { stock: d.stock, motivo: d.motivo }
  });
  const filaMaterial = await fila(conn, 'SELECT * FROM materia_prima WHERE id = ?', [d.materia_prima_id]);
  const payload = {
    id: filaMaterial!.id, nombre: filaMaterial!.nombre, categoria: filaMaterial!.categoria,
    precio: numero(filaMaterial!.precio), stock: numero(filaMaterial!.stock),
    version: numero(filaMaterial!.version), updated_at: filaMaterial!.updated_at, deleted_at: filaMaterial!.deleted_at
  };
  const seq = await registrarCambio(conn, {
    entidad: 'materia_prima', entidadId: d.materia_prima_id, operacion: 'upsert', payload, usuarioId, dispositivoId
  });
  return { ...base(cambio), estado: 'aplicado', seq };
}

async function registrarCambioTalla(
  conn: PoolConnection,
  tallaId: string,
  usuarioId: string,
  dispositivoId: string | null
): Promise<void> {
  const t = await fila(conn, 'SELECT * FROM tallas WHERE id = ?', [tallaId]);
  if (!t) return;
  await registrarCambio(conn, {
    entidad: 'talla', entidadId: tallaId, operacion: 'upsert',
    payload: {
      id: t.id, producto_id: t.producto_id, talla: numero(t.talla), stock: numero(t.stock),
      version: numero(t.version), updated_at: t.updated_at, deleted_at: t.deleted_at
    },
    usuarioId, dispositivoId
  });
}

async function registrarCambioMaterial(
  conn: PoolConnection,
  materialId: string,
  usuarioId: string,
  dispositivoId: string | null
): Promise<void> {
  const m = await fila(conn, 'SELECT * FROM materia_prima WHERE id = ?', [materialId]);
  if (!m) return;
  await registrarCambio(conn, {
    entidad: 'materia_prima', entidadId: materialId, operacion: 'upsert',
    payload: {
      id: m.id, nombre: m.nombre, categoria: m.categoria, precio: numero(m.precio), stock: numero(m.stock),
      version: numero(m.version), updated_at: m.updated_at, deleted_at: m.deleted_at
    },
    usuarioId, dispositivoId
  });
}

function tablaDeEntidad(entidad: string): string | null {
  switch (entidad) {
    case 'cliente': return 'clientes';
    case 'producto': return 'productos';
    case 'talla': return 'tallas';
    case 'proveedor': return 'proveedores';
    case 'materia_prima': return 'materia_prima';
    default: return null;
  }
}

async function procesarCambio(
  cambio: CambioRecibido,
  usuarioId: string,
  dispositivoId: string | null
): Promise<ResultadoCambio> {
  return conTransaccion(async conn => {
    if (cambio.idempotency_key) {
      const [insertado] = await conn.query(
        `INSERT IGNORE INTO sync_recibidos
           (idempotency_key, entidad, entidad_id, usuario_id, dispositivo_id, recibido_en)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [cambio.idempotency_key, cambio.entidad, cambio.entidad_id, usuarioId, dispositivoId]
      ) as [ResultSetHeader, unknown];
      if (insertado.affectedRows === 0) {
        return { ...base(cambio), estado: 'duplicado', mensaje: 'Ese cambio ya fue recibido.' };
      }
    }

    switch (cambio.entidad) {
      case 'venta': return procesarVenta(conn, cambio, usuarioId, dispositivoId);
      case 'compra': return procesarCompra(conn, cambio, usuarioId, dispositivoId);
      case 'ajuste_stock': return procesarAjusteStock(conn, cambio, usuarioId, dispositivoId);
      case 'ajuste_stock_material': return procesarAjusteMaterial(conn, cambio, usuarioId, dispositivoId);
      default: return procesarCatalogo(conn, cambio, usuarioId, dispositivoId);
    }
  });
}

export async function procesarPush(
  cambios: CambioRecibido[],
  usuarioId: string,
  dispositivoId: string | null,
  rol: 'admin' | 'normal' = 'normal'
): Promise<ResultadoCambio[]> {
  const resultados: ResultadoCambio[] = [];
  for (const cambio of cambios) {
    if (rol !== 'admin' && (ENTIDADES_SOLO_ADMIN.has(cambio.entidad) || ventaRequiereAdmin(cambio))) {
      resultados.push({
        ...base(cambio),
        estado: 'conflicto',
        mensaje: motivoSoloAdmin(cambio)
      });
      continue;
    }
    try {
      resultados.push(await procesarCambio(cambio, usuarioId, dispositivoId));
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error al aplicar el cambio.';
      const estado = error instanceof ConflictoError ? 'conflicto' : 'error';
      resultados.push({ ...base(cambio), estado, mensaje });
    }
  }
  return resultados;
}
