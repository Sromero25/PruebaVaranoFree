/**
 * outbox.ts
 * ----------------------------------------------------------------------------
 * Cola local de cambios. Cada escritura de negocio guarda aquí su cambio en la
 * misma transacción de Dexie, para que no se pierda si se cierra la app.
 */

import { db, type EntidadSync, type OutboxItem } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import {
  payloadCliente, payloadCompra, payloadMaterial, payloadProducto,
  payloadProductoCosto, payloadProveedor, payloadTalla, payloadVenta
} from './serializar.js';

export async function encolarCambio(
  entidad: EntidadSync,
  entidadId: string,
  operacion: 'upsert' | 'delete',
  payload: unknown
): Promise<void> {
  const item: OutboxItem = {
    id: uuidv4(),
    entidad,
    entidad_id: entidadId,
    operacion,
    payload,
    estado: 'pendiente',
    intentos: 0,
    proximo_intento: 0,
    creado_en: new Date().toISOString()
  };
  await db.outbox.add(item);
  // Avisa al motor para que intente enviar pronto, sin bloquear la transacción.
  setTimeout(() => window.dispatchEvent(new CustomEvent('varano-outbox')), 0);
}

export const encolarCliente = (c: Parameters<typeof payloadCliente>[0]): Promise<void> =>
  encolarCambio('cliente', c.IDCliente, 'upsert', payloadCliente(c));

export const encolarProducto = (p: Parameters<typeof payloadProducto>[0]): Promise<void> =>
  encolarCambio('producto', p.IDModelo, 'upsert', payloadProducto(p));

export const encolarProductoCosto = (c: Parameters<typeof payloadProductoCosto>[0]): Promise<void> =>
  encolarCambio('producto_costo', c.IDCosto, 'upsert', payloadProductoCosto(c));

export const encolarTalla = (t: Parameters<typeof payloadTalla>[0]): Promise<void> =>
  encolarCambio('talla', t.IDTalla, 'upsert', payloadTalla(t));

export const encolarProveedor = (p: Parameters<typeof payloadProveedor>[0]): Promise<void> =>
  encolarCambio('proveedor', p.IDProveedor, 'upsert', payloadProveedor(p));

export const encolarMaterial = (m: Parameters<typeof payloadMaterial>[0]): Promise<void> =>
  encolarCambio('materia_prima', m.IDItem, 'upsert', payloadMaterial(m));

export const encolarVenta = (
  v: Parameters<typeof payloadVenta>[0],
  detalles: Parameters<typeof payloadVenta>[1],
  correccion = false
): Promise<void> =>
  encolarCambio('venta', v.IDVenta, 'upsert', payloadVenta(v, detalles, correccion));

export const encolarCompra = (c: Parameters<typeof payloadCompra>[0], detalles: Parameters<typeof payloadCompra>[1]): Promise<void> =>
  encolarCambio('compra', c.IDCompra, 'upsert', payloadCompra(c, detalles));

export const encolarAjusteStock = (tallaId: string, stock: number, motivo?: string): Promise<void> =>
  encolarCambio('ajuste_stock', tallaId, 'upsert', { talla_id: tallaId, stock, motivo });

export const encolarAjusteMaterial = (materialId: string, stock: number, motivo?: string): Promise<void> =>
  encolarCambio('ajuste_stock_material', materialId, 'upsert', { materia_prima_id: materialId, stock, motivo });

export const encolarEliminar = (entidad: EntidadSync, id: string): Promise<void> =>
  encolarCambio(entidad, id, 'delete', { id });
