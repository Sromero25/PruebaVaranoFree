/**
 * engine.ts
 * ----------------------------------------------------------------------------
 * Motor de sincronización offline-first:
 *  1. Empuja la cola `outbox` al servidor (catálogos primero).
 *  2. Descarga cambios desde el cursor `ultimo_seq`.
 *  3. Aplica los cambios remotos a IndexedDB.
 *  4. Deja estado visible y alertas de stock negativo/conflictos.
 */

import { api, ApiError, leerTokenApi, type CambioPull, type ResultadoPush } from '../api.js';
import {
  db, guardarEstado, idDispositivo, leerEstado, type EntidadSync, type OutboxItem
} from '../db.js';
import { obtenerUsuarioActual } from '../auth.js';
import { notificar } from '../herramientas.js';
import { v4 as uuidv4 } from 'uuid';
import {
  clienteDesdePayload, compraDesdePayload, detallesCompraDesdePayload,
  detallesVentaDesdePayload, materialDesdePayload, productoDesdeCostoPayload,
  productoDesdePayload, proveedorDesdePayload, tallaDesdePayload, ventaDesdePayload
} from './serializar.js';

const INTERVALO_MS = 45_000;
const LOTE = 100;
const PRIORIDAD: Record<string, number> = {
  cliente: 1,
  producto: 1,
  talla: 1,
  proveedor: 1,
  materia_prima: 1,
  producto_costo: 2,
  ajuste_stock: 2,
  ajuste_stock_material: 2,
  venta: 3,
  compra: 3
};

let intervalo: ReturnType<typeof setInterval> | undefined;
let enCurso = false;
let ultimoError: string | null = null;
let ultimaSync: number | null = null;
let alCambiarDatos: (() => Promise<void>) | null = null;

function emitir(): void {
  window.dispatchEvent(new CustomEvent('varano-sync'));
}

export interface EstadoSync {
  online: boolean;
  pendientes: number;
  conflictos: number;
  sincronizando: boolean;
  ultimoError: string | null;
  ultimaSync: number | null;
}

export async function obtenerEstadoSync(): Promise<EstadoSync> {
  const [pendientes, conflictos] = await Promise.all([
    db.outbox.where('estado').anyOf('pendiente', 'error').count(),
    db.conflictos.where('estado').equals('pendiente').count()
  ]);
  return {
    online: navigator.onLine,
    pendientes,
    conflictos,
    sincronizando: enCurso,
    ultimoError,
    ultimaSync
  };
}

function retroceso(intentos: number): number {
  return Math.min(5 * 60_000, 5_000 * Math.pow(2, Math.max(0, intentos - 1)));
}

async function guardarAlerta(tipo: 'stock_negativo' | 'sync' | 'conflicto', mensaje: string, entidadId?: string): Promise<void> {
  const id = `${tipo}:${entidadId ?? 'general'}:${mensaje}`.slice(0, 180);
  await db.alertas.put({
    id,
    tipo,
    mensaje,
    entidad_id: entidadId,
    leida: 0,
    fecha: new Date().toISOString()
  });
}

function mensajeAdvertencia(advertencia: { talla_id?: string; materia_prima_id?: string; stock_resultante: number }): string {
  return `Stock negativo en ${advertencia.talla_id ?? advertencia.materia_prima_id ?? 'inventario'}: quedan ${advertencia.stock_resultante}.`;
}

async function aplicarResultado(item: OutboxItem, resultado: ResultadoPush): Promise<void> {
  if (resultado.estado === 'aplicado' || resultado.estado === 'duplicado') {
    await db.outbox.delete(item.id);
    await db.conflictos.delete(item.id);
    for (const advertencia of resultado.advertencias ?? []) {
      const mensaje = mensajeAdvertencia(advertencia);
      await guardarAlerta('stock_negativo', mensaje, advertencia.talla_id ?? advertencia.materia_prima_id);
      notificar(mensaje, true);
    }
    return;
  }

  const intentos = item.intentos + 1;
  await db.outbox.update(item.id, {
    estado: 'error',
    intentos,
    proximo_intento: Date.now() + retroceso(intentos),
    ultimo_error: resultado.mensaje ?? 'El servidor rechazó el cambio.'
  });
  await db.conflictos.put({
    id: item.id,
    entidad: item.entidad,
    entidad_id: item.entidad_id,
    operacion: item.operacion,
    payload: item.payload,
    mensaje: resultado.mensaje ?? 'El servidor rechazó el cambio.',
    estado: 'pendiente',
    creado_en: new Date().toISOString()
  });
  await guardarAlerta('conflicto', `Cambio rechazado (${item.entidad}): ${resultado.mensaje ?? 'revisa el historial.'}`, item.entidad_id);
}

async function empujar(forzar: boolean): Promise<boolean> {
  const ahora = Date.now();
  const candidatos = await db.outbox
    .where('estado').anyOf('pendiente', 'error')
    .filter(item => forzar || item.proximo_intento <= ahora)
    .toArray();

  if (candidatos.length === 0) return true;

  candidatos.sort((a, b) =>
    (PRIORIDAD[a.entidad] ?? 9) - (PRIORIDAD[b.entidad] ?? 9) ||
    a.creado_en.localeCompare(b.creado_en)
  );
  const lote = candidatos.slice(0, LOTE);

  for (const item of lote) {
    await db.outbox.update(item.id, { estado: 'enviando' });
  }

  const deviceId = await idDispositivo();
  try {
    const respuesta = await api.push(deviceId, nombreDispositivo(), lote.map(item => ({
      id: item.id,
      entidad: item.entidad,
      entidad_id: item.entidad_id,
      operacion: item.operacion,
      payload: item.payload,
      idempotency_key: item.id
    })));

    const porId = new Map(respuesta.resultados.map(r => [r.id, r]));
    for (const item of lote) {
      const resultado = porId.get(item.id);
      if (!resultado) {
        await db.outbox.update(item.id, {
          estado: 'error',
          intentos: item.intentos + 1,
          proximo_intento: Date.now() + retroceso(item.intentos + 1),
          ultimo_error: 'El servidor no respondió por este cambio.'
        });
        continue;
      }
      await aplicarResultado(item, resultado);
    }
    return true;
  } catch (error) {
    const mensaje = error instanceof ApiError
      ? (error.estado === 0 ? 'Sin conexión con el servidor.' : error.message)
      : 'No se pudo enviar la cola de cambios.';

    for (const item of lote) {
      const intentos = item.intentos + 1;
      await db.outbox.update(item.id, {
        estado: 'pendiente',
        intentos,
        proximo_intento: Date.now() + retroceso(intentos),
        ultimo_error: mensaje
      });
    }
    ultimoError = mensaje;
    return false;
  }
}

function nombreDispositivo(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone/iPad';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'Navegador';
}

async function aplicarCambioRemoto(cambio: CambioPull): Promise<void> {
  const p = cambio.payload ?? {};
  const entidad = cambio.entidad;

  if (entidad === 'venta') {
    if (cambio.operacion === 'delete') {
      await db.ventas.update(cambio.entidad_id, { deleted_at: p.deleted_at ?? new Date().toISOString() });
      return;
    }
    const venta = ventaDesdePayload(p);
    const detalles = detallesVentaDesdePayload(p);
    await db.transaction('rw', [db.ventas, db.ventaDetalle], async () => {
      await db.ventas.put(venta);
      await db.ventaDetalle.where('IDVenta').equals(venta.IDVenta).delete();
      if (detalles.length) await db.ventaDetalle.bulkPut(detalles);
    });
    return;
  }

  if (entidad === 'compra') {
    if (cambio.operacion === 'delete') {
      await db.compras.update(cambio.entidad_id, { deleted_at: p.deleted_at ?? new Date().toISOString() });
      return;
    }
    const compra = compraDesdePayload(p);
    const detalles = detallesCompraDesdePayload(p);
    await db.transaction('rw', [db.compras, db.compraDetalle], async () => {
      await db.compras.put(compra);
      await db.compraDetalle.where('IDCompra').equals(compra.IDCompra).delete();
      if (detalles.length) await db.compraDetalle.bulkPut(detalles);
    });
    return;
  }

  if (cambio.operacion === 'delete') {
    const tabla = tablaDeEntidad(entidad);
    if (tabla) await db.table(tabla).update(cambio.entidad_id, { deleted_at: p.deleted_at ?? new Date().toISOString() });
    return;
  }

  switch (entidad) {
    case 'cliente': await db.clientes.put(clienteDesdePayload(p)); break;
    case 'producto': await db.productos.put(productoDesdePayload(p)); break;
    case 'talla': await db.tallas.put(tallaDesdePayload(p)); break;
    case 'proveedor': await db.proveedores.put(proveedorDesdePayload(p)); break;
    case 'materia_prima': await db.materiaPrima.put(materialDesdePayload(p)); break;
    case 'producto_costo': await db.productoCostos.put(productoDesdeCostoPayload(p)); break;
    case 'ajuste_stock': await db.tallas.put(tallaDesdePayload(p)); break;
    case 'ajuste_stock_material': await db.materiaPrima.put(materialDesdePayload(p)); break;
    default: break;
  }
}

function tablaDeEntidad(entidad: EntidadSync): string | null {
  switch (entidad) {
    case 'cliente': return 'clientes';
    case 'producto': return 'productos';
    case 'talla': return 'tallas';
    case 'proveedor': return 'proveedores';
    case 'materia_prima': return 'materia_prima';
    default: return null;
  }
}

async function jalar(): Promise<number> {
  let since = Number(await leerEstado('ultimo_seq') ?? 0);
  let aplicados = 0;

  for (let vueltas = 0; vueltas < 50; vueltas++) {
    const respuesta = await api.pull(since, 200);
    for (const cambio of respuesta.cambios) {
      // Los cambios traen valores absolutos (stock, totales, líneas), así que
      // aplicar también los del propio dispositivo es idempotente y mantiene
      // el orden del servidor. Si uno falla, no debe bloquear los demás.
      try {
        await aplicarCambioRemoto(cambio);
        aplicados++;
      } catch (error) {
        console.error('No se pudo aplicar un cambio remoto:', cambio, error);
        await guardarAlerta('sync', `No se pudo aplicar un cambio de ${cambio.entidad}.`, cambio.entidad_id);
      }
    }
    since = respuesta.nextSeq;
    await guardarEstado('ultimo_seq', since);
    if (!respuesta.hasMore) break;
  }
  return aplicados;
}

export async function sincronizarAhora(forzar = false): Promise<void> {
  if (enCurso) return;
  if (!obtenerUsuarioActual() || !leerTokenApi()) return;

  enCurso = true;
  ultimoError = null;
  emitir();

  try {
    // Si la app se cerró a mitad de un envío, esos cambios quedaron "enviando".
    await db.outbox.where('estado').equals('enviando').modify({ estado: 'pendiente' });

    const envioOk = await empujar(forzar);
    if (!envioOk) {
      emitir();
      return;
    }

    const aplicados = await jalar();
    ultimaSync = Date.now();
    await guardarEstado('ultima_sync', ultimaSync);

    if (aplicados > 0 && alCambiarDatos) await alCambiarDatos();
  } catch (error) {
    ultimoError = error instanceof ApiError
      ? (error.estado === 0 ? 'Sin conexión con el servidor.' : error.message)
      : 'Error de sincronización.';
    if (ultimoError === 'Sesión inválida o vencida.') {
      await guardarAlerta('sync', ultimoError);
    }
  } finally {
    enCurso = false;
    emitir();
  }
}

export function iniciarMotorSync(refrescar: () => Promise<void>): void {
  alCambiarDatos = refrescar;
  if (intervalo) return;

  window.addEventListener('online', () => { emitir(); void sincronizarAhora(true); });
  window.addEventListener('offline', () => emitir());
  window.addEventListener('varano-outbox', () => { void sincronizarAhora(); });

  intervalo = setInterval(() => { void sincronizarAhora(); }, INTERVALO_MS);
  void sincronizarAhora();
}

export function detenerMotorSync(): void {
  if (intervalo) clearInterval(intervalo);
  intervalo = undefined;
  alCambiarDatos = null;
}

export async function reintentarConflictos(): Promise<void> {
  const conflictos = await db.conflictos.where('estado').equals('pendiente').toArray();
  for (const conflicto of conflictos) {
    const item = await db.outbox.get(conflicto.id);
    if (item) {
      await db.outbox.update(item.id, { estado: 'pendiente', proximo_intento: 0 });
    }
    await db.conflictos.update(conflicto.id, { estado: 'resuelto' });
  }
  await sincronizarAhora(true);
}

export async function crearAlertaLocal(tipo: 'sync' | 'conflicto', mensaje: string): Promise<void> {
  await guardarAlerta(tipo, mensaje, uuidv4());
  emitir();
}
