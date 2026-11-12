/**
 * db.ts
 * ----------------------------------------------------------------------------
 * Base local (IndexedDB con Dexie) del sistema Varano.
 *
 * La base se llama `VaranoDB` para no chocar con la base anterior
 * (`TallerCalzadoDB`), cuyo esquema usaba claves autoincrementales. Al abrir,
 * se intenta copiar una sola vez el histórico de la base anterior,
 * convirtiendo sus IDs numéricos a UUID.
 *
 * Aquí viven también las tablas de sincronización:
 *  - outbox    : cambios locales pendientes de enviar al servidor.
 *  - syncState : cursor de pull, id de dispositivo, banderas.
 *  - conflictos: cambios que el servidor rechazó.
 *  - alertas   : avisos, por ejemplo stock negativo.
 */

import { Dexie, type Table } from 'dexie';
import { v4 as uuidv4 } from 'uuid';

export type Rol = 'admin' | 'normal';

/** Campos que toda entidad sincronizable lleva. */
export interface SyncFields {
  updated_at?: string;
  deleted_at?: string | null;
  version?: number;
}

export interface Producto extends SyncFields {
  IDModelo: string;
  Modelo: string;
  PrecioBase: number;
  /** Costo vigente por par (producción o compra). Se usa para la utilidad. */
  CostoBase?: number;
}

/** Cambio histórico del costo por par de un modelo. */
export interface ProductoCosto extends SyncFields {
  IDCosto: string;
  IDModelo: string;
  Costo: number;
  VigenteDesde: string;
}

export interface Tallas extends SyncFields {
  IDTalla: string;
  IDModelo: string;
  Talla: number;
  Stock: number;
}

export interface Cliente extends SyncFields {
  IDCliente: string;
  Nombre: string;
  Apellido: string;
  Telefono?: string;
  Direccion?: string;
}

/** Cabecera de venta. El detalle está en `VentaDetalle`. */
export interface Venta extends SyncFields {
  IDVenta: string;
  IDCliente: string;
  Fecha: Date;
  Total: number;
  UsuarioID?: string;
  Estado?: 'activa' | 'anulada';
  AnuladaEn?: string | null;
  AnuladaPor?: string | null;
}

export interface VentaDetalle {
  IDDetalle: string;
  IDVenta: string;
  IDTalla: string;
  Cantidad: number;
  PrecioUnitario: number;
  /** Costo del par al momento de la venta; no cambia si luego sube el costo. */
  CostoUnitario?: number;
}

export interface Proveedor extends SyncFields {
  IDProveedor: string;
  Nombre: string;
  Telefono: string;
  Direccion: string;
  Correo?: string;
}

/** Cabecera de compra. */
export interface Compra extends SyncFields {
  IDCompra: string;
  IDProveedor: string;
  Fecha: Date;
  Total: number;
  UsuarioID?: string;
  Estado?: 'activa' | 'anulada';
  AnuladaEn?: string | null;
  AnuladaPor?: string | null;
}

export interface CompraDetalle {
  IDDetalle: string;
  IDCompra: string;
  IDItem: string;
  Cantidad: number;
  PrecioUnitario: number;
}

export interface InventarioMPrima extends SyncFields {
  IDItem: string;
  Nombre: string;
  Categoria: string;
  Precio: number;
  Stock: number;
}

/** Usuario cacheado para poder mostrar el panel y validar UX sin internet. */
export interface Usuario {
  IDUsuario: string;
  Usuario: string;
  Nombre: string;
  Rol: Rol;
  Activo: 0 | 1;
  updated_at?: string;
}

export type EntidadSync =
  | 'cliente'
  | 'producto'
  | 'talla'
  | 'proveedor'
  | 'materia_prima'
  | 'producto_costo'
  | 'venta'
  | 'compra'
  | 'ajuste_stock'
  | 'ajuste_stock_material';

export interface OutboxItem {
  id: string;
  entidad: EntidadSync;
  entidad_id: string;
  operacion: 'upsert' | 'delete';
  payload: unknown;
  estado: 'pendiente' | 'enviando' | 'error';
  intentos: number;
  proximo_intento: number;
  creado_en: string;
  ultimo_error?: string;
}

export interface SyncState {
  clave: string;
  valor: string | number | boolean | null;
}

export interface Conflicto {
  id: string;
  entidad: EntidadSync;
  entidad_id: string;
  operacion: 'upsert' | 'delete';
  payload: unknown;
  mensaje: string;
  estado: 'pendiente' | 'resuelto';
  creado_en: string;
}

export interface Alerta {
  id: string;
  tipo: 'stock_negativo' | 'sync' | 'conflicto';
  mensaje: string;
  entidad_id?: string;
  leida: 0 | 1;
  fecha: string;
}

export class VaranoDB extends Dexie {
  productos!: Table<Producto, string>;
  tallas!: Table<Tallas, string>;
  clientes!: Table<Cliente, string>;
  ventas!: Table<Venta, string>;
  ventaDetalle!: Table<VentaDetalle, string>;
  proveedores!: Table<Proveedor, string>;
  compras!: Table<Compra, string>;
  compraDetalle!: Table<CompraDetalle, string>;
  materiaPrima!: Table<InventarioMPrima, string>;
  productoCostos!: Table<ProductoCosto, string>;
  usuarios!: Table<Usuario, string>;
  outbox!: Table<OutboxItem, string>;
  syncState!: Table<SyncState, string>;
  conflictos!: Table<Conflicto, string>;
  alertas!: Table<Alerta, string>;

  constructor() {
    super('VaranoDB');

    this.version(1).stores({
      productos: 'IDModelo, Modelo, deleted_at',
      tallas: 'IDTalla, IDModelo, Talla, [IDModelo+Talla], deleted_at',
      clientes: 'IDCliente, Nombre, Apellido, deleted_at',
      ventas: 'IDVenta, IDCliente, Fecha, Estado, deleted_at',
      ventaDetalle: 'IDDetalle, IDVenta, IDTalla',
      proveedores: 'IDProveedor, Nombre, deleted_at',
      compras: 'IDCompra, IDProveedor, Fecha, Estado, deleted_at',
      compraDetalle: 'IDDetalle, IDCompra, IDItem',
      materiaPrima: 'IDItem, Categoria, deleted_at',
      usuarios: 'IDUsuario, &Usuario',
      outbox: 'id, estado, entidad, entidad_id, proximo_intento, creado_en',
      syncState: 'clave',
      conflictos: 'id, entidad, entidad_id, estado, creado_en',
      alertas: 'id, tipo, leida, fecha'
    });

    // v2: historial de costos por modelo (para comparar utilidad histórica).
    this.version(2).stores({
      productos: 'IDModelo, Modelo, deleted_at',
      tallas: 'IDTalla, IDModelo, Talla, [IDModelo+Talla], deleted_at',
      clientes: 'IDCliente, Nombre, Apellido, deleted_at',
      ventas: 'IDVenta, IDCliente, Fecha, Estado, deleted_at',
      ventaDetalle: 'IDDetalle, IDVenta, IDTalla',
      proveedores: 'IDProveedor, Nombre, deleted_at',
      compras: 'IDCompra, IDProveedor, Fecha, Estado, deleted_at',
      compraDetalle: 'IDDetalle, IDCompra, IDItem',
      materiaPrima: 'IDItem, Categoria, deleted_at',
      productoCostos: 'IDCosto, IDModelo, VigenteDesde',
      usuarios: 'IDUsuario, &Usuario',
      outbox: 'id, estado, entidad, entidad_id, proximo_intento, creado_en',
      syncState: 'clave',
      conflictos: 'id, entidad, entidad_id, estado, creado_en',
      alertas: 'id, tipo, leida, fecha'
    });
  }
}

export const db = new VaranoDB();

// ---------------------------------------------------------------- estado sync

export async function leerEstado(clave: string): Promise<string | number | boolean | null> {
  const fila = await db.syncState.get(clave);
  return fila?.valor ?? null;
}

export async function guardarEstado(clave: string, valor: string | number | boolean | null): Promise<void> {
  await db.syncState.put({ clave, valor });
}

export async function idDispositivo(): Promise<string> {
  const guardado = await leerEstado('device_id');
  if (typeof guardado === 'string' && guardado) return guardado;
  const id = uuidv4();
  await guardarEstado('device_id', id);
  return id;
}

// ---------------------------------------------------------------- migración legacy

interface DatosLegacy {
  productos: any[];
  tallas: any[];
  clientes: any[];
  proveedores: any[];
  materiaPrima: any[];
  ventas: any[];
  ventaDetalle: any[];
  compras: any[];
  compraDetalle: any[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function nuevoId(mapa: Map<string, string>, valor: unknown): string {
  const clave = String(valor ?? '');
  if (!clave) return uuidv4();
  if (UUID_RE.test(clave)) return clave;
  const existente = mapa.get(clave);
  if (existente) return existente;
  const id = uuidv4();
  mapa.set(clave, id);
  return id;
}

function leerStore<T>(base: IDBDatabase, nombre: string): Promise<T[]> {
  return new Promise(resolve => {
    if (!base.objectStoreNames.contains(nombre)) return resolve([]);
    const tx = base.transaction(nombre, 'readonly');
    const req = tx.objectStore(nombre).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as T[]);
    req.onerror = () => resolve([]);
  });
}

async function abrirBaseAntigua(): Promise<IDBDatabase | null> {
  try {
    if (indexedDB.databases) {
      const bases = await indexedDB.databases();
      if (!bases.some(b => b.name === 'TallerCalzadoDB')) return null;
    }
  } catch { /* algunos navegadores no lo soportan */ }

  return new Promise(resolve => {
    const req = indexedDB.open('TallerCalzadoDB');
    req.onsuccess = () => {
      const base = req.result;
      if (base.objectStoreNames.length === 0) {
        base.close();
        indexedDB.deleteDatabase('TallerCalzadoDB');
        resolve(null);
        return;
      }
      resolve(base);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function leerLegacy(): Promise<DatosLegacy | null> {
  const base = await abrirBaseAntigua();
  if (!base) return null;
  try {
    const [productos, tallas, clientes, proveedores, materiaPrima, ventas, ventaDetalle, compras, compraDetalle] =
      await Promise.all([
        leerStore<any>(base, 'productos'),
        leerStore<any>(base, 'tallas'),
        leerStore<any>(base, 'clientes'),
        leerStore<any>(base, 'proveedores'),
        leerStore<any>(base, 'materiaPrima'),
        leerStore<any>(base, 'ventas'),
        leerStore<any>(base, 'ventaDetalle'),
        leerStore<any>(base, 'compras'),
        leerStore<any>(base, 'compraDetalle')
      ]);
    return { productos, tallas, clientes, proveedores, materiaPrima, ventas, ventaDetalle, compras, compraDetalle };
  } finally {
    base.close();
  }
}

async function migrarLegacy(): Promise<void> {
  if (await leerEstado('legacy_migrado')) return;

  const datos = await leerLegacy();
  if (!datos) {
    await guardarEstado('legacy_migrado', true);
    return;
  }

  const mapProducto = new Map<string, string>();
  const mapTalla = new Map<string, string>();
  const mapCliente = new Map<string, string>();
  const mapProveedor = new Map<string, string>();
  const mapMaterial = new Map<string, string>();
  const mapVenta = new Map<string, string>();
  const mapCompra = new Map<string, string>();

  const ahora = new Date().toISOString();
  const sync = { updated_at: ahora, deleted_at: null, version: 1 };

  const productos: Producto[] = datos.productos.map(p => ({
    IDModelo: nuevoId(mapProducto, p.IDModelo ?? p.id),
    Modelo: String(p.Modelo ?? p.modelo ?? ''),
    PrecioBase: Number(p.PrecioBase ?? p.precio_base ?? 0),
    CostoBase: Number(p.CostoBase ?? p.costo_base ?? 0),
    ...sync
  }));

  const productoCostos: ProductoCosto[] = productos
    .filter(p => (p.CostoBase ?? 0) > 0)
    .map(p => ({
      IDCosto: uuidv4(),
      IDModelo: p.IDModelo,
      Costo: p.CostoBase ?? 0,
      VigenteDesde: ahora,
      ...sync
    }));

  const tallas: Tallas[] = datos.tallas.map(t => ({
    IDTalla: nuevoId(mapTalla, t.IDTalla ?? t.id),
    IDModelo: nuevoId(mapProducto, t.IDModelo ?? t.producto_id),
    Talla: Number(t.Talla ?? t.talla ?? 0),
    Stock: Number(t.Stock ?? t.stock ?? 0),
    ...sync
  }));

  const clientes: Cliente[] = datos.clientes.map(c => ({
    IDCliente: nuevoId(mapCliente, c.IDCliente ?? c.id),
    Nombre: String(c.Nombre ?? c.nombre ?? ''),
    Apellido: String(c.Apellido ?? c.apellido ?? ''),
    Telefono: c.Telefono ?? c.telefono ?? '',
    Direccion: c.Direccion ?? c.direccion ?? '',
    ...sync
  }));

  const proveedores: Proveedor[] = datos.proveedores.map(p => ({
    IDProveedor: nuevoId(mapProveedor, p.IDProveedor ?? p.id),
    Nombre: String(p.Nombre ?? p.nombre ?? ''),
    Telefono: String(p.Telefono ?? p.telefono ?? ''),
    Direccion: String(p.Direccion ?? p.direccion ?? ''),
    Correo: p.Correo ?? p.correo ?? '',
    ...sync
  }));

  const materiaPrima: InventarioMPrima[] = datos.materiaPrima.map(m => ({
    IDItem: nuevoId(mapMaterial, m.IDItem ?? m.id),
    Nombre: String(m.Nombre ?? m.nombre ?? ''),
    Categoria: String(m.Categoria ?? m.categoria ?? ''),
    Precio: Number(m.Precio ?? m.precio ?? 0),
    Stock: Number(m.Stock ?? m.stock ?? 0),
    ...sync
  }));

  const ventas: Venta[] = datos.ventas.map(v => ({
    IDVenta: nuevoId(mapVenta, v.IDVenta ?? v.id),
    IDCliente: nuevoId(mapCliente, v.IDCliente ?? v.cliente_id),
    Fecha: v.Fecha ? new Date(v.Fecha) : new Date(),
    Total: Number(v.Total ?? v.total ?? 0),
    Estado: v.Estado ?? 'activa',
    ...sync
  }));

  const ventaDetalle: VentaDetalle[] = datos.ventaDetalle.map(d => {
    const costo = d.CostoUnitario ?? d.costo_unitario;
    return {
      IDDetalle: UUID_RE.test(String(d.IDDetalle ?? '')) ? String(d.IDDetalle) : uuidv4(),
      IDVenta: nuevoId(mapVenta, d.IDVenta ?? d.venta_id),
      IDTalla: nuevoId(mapTalla, d.IDTalla ?? d.talla_id),
      Cantidad: Number(d.Cantidad ?? d.cantidad ?? 0),
      PrecioUnitario: Number(d.PrecioUnitario ?? d.precio_unitario ?? 0),
      ...(costo !== undefined && costo !== null ? { CostoUnitario: Number(costo) } : {})
    };
  });

  const compras: Compra[] = datos.compras.map(c => ({
    IDCompra: nuevoId(mapCompra, c.IDCompra ?? c.id),
    IDProveedor: nuevoId(mapProveedor, c.IDProveedor ?? c.proveedor_id),
    Fecha: c.Fecha ? new Date(c.Fecha) : new Date(),
    Total: Number(c.Total ?? c.total ?? 0),
    Estado: c.Estado ?? 'activa',
    ...sync
  }));

  const compraDetalle: CompraDetalle[] = datos.compraDetalle.map(d => ({
    IDDetalle: UUID_RE.test(String(d.IDDetalle ?? '')) ? String(d.IDDetalle) : uuidv4(),
    IDCompra: nuevoId(mapCompra, d.IDCompra ?? d.compra_id),
    IDItem: nuevoId(mapMaterial, d.IDItem ?? d.materia_prima_id),
    Cantidad: Number(d.Cantidad ?? d.cantidad ?? 0),
    PrecioUnitario: Number(d.PrecioUnitario ?? d.precio_unitario ?? 0)
  }));

  await db.transaction(
    'rw',
    [db.productos, db.tallas, db.clientes, db.proveedores, db.materiaPrima, db.productoCostos, db.ventas, db.ventaDetalle, db.compras, db.compraDetalle],
    async () => {
      if (productos.length) await db.productos.bulkPut(productos);
      if (tallas.length) await db.tallas.bulkPut(tallas);
      if (clientes.length) await db.clientes.bulkPut(clientes);
      if (proveedores.length) await db.proveedores.bulkPut(proveedores);
      if (materiaPrima.length) await db.materiaPrima.bulkPut(materiaPrima);
      if (productoCostos.length) await db.productoCostos.bulkPut(productoCostos);
      if (ventas.length) await db.ventas.bulkPut(ventas);
      if (ventaDetalle.length) await db.ventaDetalle.bulkPut(ventaDetalle);
      if (compras.length) await db.compras.bulkPut(compras);
      if (compraDetalle.length) await db.compraDetalle.bulkPut(compraDetalle);
    }
  );

  await guardarEstado('legacy_migrado', true);
  console.log('Datos de TallerCalzadoDB copiados a VaranoDB.');
}

let inicializada: Promise<void> | null = null;

/** Abre la base y ejecuta la migración legacy una sola vez. */
export function inicializarBaseLocal(): Promise<void> {
  if (!inicializada) {
    inicializada = (async () => {
      await db.open();
      await migrarLegacy();
    })();
  }
  return inicializada;
}
