/**
 * servicios.ts
 * ----------------------------------------------------------------------------
 * Operaciones que MODIFICAN la base local. Cada escritura:
 *  1. Actualiza IndexedDB (con `updated_at`, `version` y borrado lógico).
 *  2. Encola el cambio en `outbox` dentro de la misma transacción.
 *  3. Deja que el motor de sync lo envíe cuando haya conexión.
 */

import { db, type ProductoCosto } from './db.js';
import { obtenerUsuarioActual, requerirAdmin, requerirSesion } from './auth.js';
import { v4 as uuidv4 } from 'uuid';
import {
  encolarAjusteMaterial, encolarAjusteStock, encolarCliente, encolarCompra,
  encolarEliminar, encolarMaterial, encolarProducto, encolarProductoCosto,
  encolarProveedor, encolarTalla, encolarVenta
} from './sync/outbox.js';
import { payloadVenta } from './sync/serializar.js';

// ---------------------------------------------------------------- validación

function texto(valor: string | undefined, campo: string, max = 80, obligatorio = true): string {
  const v = (valor ?? '').trim();
  if (obligatorio && v.length === 0) throw new Error(`${campo} es obligatorio.`);
  if (v.length > max) throw new Error(`${campo} no puede pasar de ${max} caracteres.`);
  return v;
}

function numero(
  valor: number,
  campo: string,
  opts: { min?: number; entero?: boolean; positivo?: boolean } = {}
): number {
  if (!Number.isFinite(valor)) throw new Error(`${campo} no es un número válido.`);
  if (opts.entero && !Number.isInteger(valor)) throw new Error(`${campo} debe ser un número entero.`);
  if (opts.positivo && valor <= 0) throw new Error(`${campo} debe ser mayor que 0.`);
  if (opts.min !== undefined && valor < opts.min) throw new Error(`${campo} no puede ser menor que ${opts.min}.`);
  return valor;
}

const redondear2 = (n: number): number => Math.round(n * 100) / 100;
const ahora = (): string => new Date().toISOString();
const activo = <T extends { deleted_at?: string | null }>(x: T): boolean => !x.deleted_at;

/** Costo vigente de un modelo; 0 si todavía no se capturó. */
async function costoDeModelo(idModelo: string | undefined): Promise<number> {
  if (!idModelo) return 0;
  const p = await db.productos.get(idModelo);
  return Number.isFinite(p?.CostoBase) ? Number(p!.CostoBase) : 0;
}

/** Registra un cambio de costo en el historial y lo encola para sincronizar. */
async function registrarCostoProducto(IDModelo: string, Costo: number): Promise<void> {
  const fila: ProductoCosto = {
    IDCosto: uuidv4(),
    IDModelo,
    Costo: redondear2(Costo),
    VigenteDesde: ahora(),
    updated_at: ahora(),
    version: 1
  };
  await db.productoCostos.add(fila);
  await encolarProductoCosto(fila);
}

// ---------------------------------------------------------------- ventas

export interface LineaVenta {
  IDTalla: string;
  Cantidad: number;
  PrecioUnitario: number;
}

/** Registra una venta con una o varias tallas y descuenta el stock local. */
export async function registrarVentaDB(IDCliente: string, lineas: LineaVenta[]): Promise<string> {
  requerirSesion();
  if (lineas.length === 0) throw new Error('Agrega al menos un par a la venta.');

  const limpias = lineas.map(l => ({
    IDTalla: texto(l.IDTalla, 'Talla'),
    Cantidad: numero(l.Cantidad, 'Cantidad', { entero: true, positivo: true }),
    PrecioUnitario: redondear2(numero(l.PrecioUnitario, 'Precio', { min: 0 }))
  }));

  return db.transaction('rw', [db.clientes, db.tallas, db.productos, db.ventas, db.ventaDetalle, db.outbox], async () => {
    const cliente = await db.clientes.get(IDCliente);
    if (!cliente || !activo(cliente)) throw new Error('El cliente no existe.');

    const pedidos = new Map<string, number>();
    for (const l of limpias) pedidos.set(l.IDTalla, (pedidos.get(l.IDTalla) ?? 0) + l.Cantidad);

    const costos = new Map<string, number>();
    for (const [idTalla, cant] of pedidos) {
      const t = await db.tallas.get(idTalla);
      if (!t || !activo(t)) throw new Error('Una de las tallas ya no existe.');
      if (t.Stock < cant) throw new Error(`Stock insuficiente en talla ${t.Talla}: quedan ${t.Stock} pares.`);
      costos.set(idTalla, await costoDeModelo(t.IDModelo));
      await db.tallas.update(idTalla, {
        Stock: t.Stock - cant,
        updated_at: ahora(),
        version: (t.version ?? 1) + 1
      });
    }

    const total = redondear2(limpias.reduce((acc, l) => acc + l.Cantidad * l.PrecioUnitario, 0));
    const idVenta = uuidv4();
    const venta = {
      IDVenta: idVenta,
      IDCliente,
      Fecha: new Date(),
      Total: total,
      UsuarioID: obtenerUsuarioActual()?.IDUsuario,
      Estado: 'activa' as const,
      AnuladaEn: null,
      AnuladaPor: null,
      updated_at: ahora(),
      version: 1
    };
    const detalles = limpias.map(l => ({
      IDDetalle: uuidv4(),
      IDVenta: idVenta,
      IDTalla: l.IDTalla,
      Cantidad: l.Cantidad,
      PrecioUnitario: l.PrecioUnitario,
      CostoUnitario: redondear2(costos.get(l.IDTalla) ?? 0)
    }));

    await db.ventas.add(venta);
    await db.ventaDetalle.bulkAdd(detalles);
    await encolarVenta(venta, detalles);
    return idVenta;
  });
}

export interface CorreccionVenta {
  IDCliente: string;
  Fecha: Date;
  lineas: { IDDetalle: string; Cantidad: number; PrecioUnitario: number }[];
}

/** (Admin) Corrige cliente, fecha, cantidades y precios de una venta ajustando el stock. */
export async function corregirVentaDB(IDVenta: string, c: CorreccionVenta): Promise<void> {
  requerirAdmin();
  if (Number.isNaN(new Date(c.Fecha).getTime())) throw new Error('La fecha no es válida.');
  const cambios = new Map(c.lineas.map(l => [l.IDDetalle, {
    Cantidad: numero(l.Cantidad, 'Cantidad', { entero: true, min: 0 }),
    PrecioUnitario: redondear2(numero(l.PrecioUnitario, 'Precio', { min: 0 }))
  }]));

  await db.transaction('rw', [db.clientes, db.tallas, db.productos, db.ventas, db.ventaDetalle, db.outbox], async () => {
    const venta = await db.ventas.get(IDVenta);
    if (!venta || !activo(venta)) throw new Error('La venta no existe.');
    if (venta.Estado === 'anulada') throw new Error('La venta está anulada; no se puede corregir.');
    const cliente = await db.clientes.get(c.IDCliente);
    if (!cliente || !activo(cliente)) throw new Error('El cliente no existe.');

    const detalles = await db.ventaDetalle.where('IDVenta').equals(IDVenta).toArray();
    const delta = new Map<string, number>();
    for (const d of detalles) {
      const nuevo = cambios.get(d.IDDetalle);
      if (!nuevo) continue;
      delta.set(d.IDTalla, (delta.get(d.IDTalla) ?? 0) + nuevo.Cantidad - d.Cantidad);
    }

    for (const [idTalla, dif] of delta) {
      if (dif === 0) continue;
      const t = await db.tallas.get(idTalla);
      if (!t) throw new Error('Una de las tallas ya no existe.');
      if (t.Stock - dif < 0) throw new Error(`Stock insuficiente en talla ${t.Talla} para ese cambio.`);
      await db.tallas.update(idTalla, {
        Stock: t.Stock - dif,
        updated_at: ahora(),
        version: (t.version ?? 1) + 1
      });
    }

    let total = 0;
    let restantes = 0;
    const finales: typeof detalles = [];
    for (const d of detalles) {
      const nuevo = cambios.get(d.IDDetalle) ?? { Cantidad: d.Cantidad, PrecioUnitario: d.PrecioUnitario };
      if (nuevo.Cantidad === 0) {
        await db.ventaDetalle.delete(d.IDDetalle);
      } else {
        const talla = await db.tallas.get(d.IDTalla);
        const actualizado = {
          ...d,
          ...nuevo,
          // Se conserva el costo original de la línea; solo se rellena si faltaba.
          CostoUnitario: d.CostoUnitario ?? redondear2(await costoDeModelo(talla?.IDModelo))
        };
        await db.ventaDetalle.put(actualizado);
        finales.push(actualizado);
        total += nuevo.Cantidad * nuevo.PrecioUnitario;
        restantes++;
      }
    }
    if (restantes === 0) throw new Error('La venta quedaría sin productos. Usa "Anular" para eliminarla.');

    const actualizada = {
      ...venta,
      IDCliente: c.IDCliente,
      Fecha: c.Fecha,
      Total: redondear2(total),
      updated_at: ahora(),
      version: (venta.version ?? 1) + 1
    };
    await db.ventas.put(actualizada);
    await encolarVenta(actualizada, finales, true);
  });
}

export async function anularVentaDB(IDVenta: string): Promise<void> {
  requerirAdmin();
  await db.transaction('rw', [db.tallas, db.ventas, db.ventaDetalle, db.outbox], async () => {
    const venta = await db.ventas.get(IDVenta);
    if (!venta || !activo(venta)) throw new Error('La venta no existe.');
    if (venta.Estado === 'anulada') throw new Error('La venta ya está anulada.');

    const detalles = await db.ventaDetalle.where('IDVenta').equals(IDVenta).toArray();
    for (const d of detalles) {
      const t = await db.tallas.get(d.IDTalla);
      if (!t) continue;
      await db.tallas.update(d.IDTalla, {
        Stock: t.Stock + d.Cantidad,
        updated_at: ahora(),
        version: (t.version ?? 1) + 1
      });
    }

    const actualizada = {
      ...venta,
      Estado: 'anulada' as const,
      AnuladaEn: ahora(),
      AnuladaPor: obtenerUsuarioActual()?.IDUsuario ?? null,
      updated_at: ahora(),
      version: (venta.version ?? 1) + 1
    };
    await db.ventas.put(actualizada);
    await encolarVenta(actualizada, detalles);
  });
}

// ---------------------------------------------------------------- compras

export interface LineaCompra {
  IDItem: string;
  Cantidad: number;
}

export async function registrarCompraDB(IDProveedor: string, lineas: LineaCompra[]): Promise<string> {
  requerirAdmin();
  if (lineas.length === 0) throw new Error('Agrega al menos un material a la compra.');

  const pedidos = new Map<string, number>();
  for (const l of lineas) {
    const cant = numero(l.Cantidad, 'Cantidad', { positivo: true });
    pedidos.set(l.IDItem, (pedidos.get(l.IDItem) ?? 0) + cant);
  }

  return db.transaction('rw', [db.proveedores, db.materiaPrima, db.compras, db.compraDetalle, db.outbox], async () => {
    const proveedor = await db.proveedores.get(IDProveedor);
    if (!proveedor || !activo(proveedor)) throw new Error('El proveedor no existe.');

    const detalles: { IDItem: string; Cantidad: number; PrecioUnitario: number }[] = [];
    let total = 0;
    for (const [idItem, cant] of pedidos) {
      const m = await db.materiaPrima.get(idItem);
      if (!m || !activo(m)) throw new Error('Uno de los materiales ya no existe.');
      if (!(m.Precio > 0)) throw new Error(`"${m.Nombre}" no tiene precio. Pide al administrador que lo registre.`);
      await db.materiaPrima.update(idItem, {
        Stock: m.Stock + cant,
        updated_at: ahora(),
        version: (m.version ?? 1) + 1
      });
      detalles.push({ IDItem: idItem, Cantidad: cant, PrecioUnitario: m.Precio });
      total += cant * m.Precio;
    }

    const idCompra = uuidv4();
    const compra = {
      IDCompra: idCompra,
      IDProveedor,
      Fecha: new Date(),
      Total: redondear2(total),
      UsuarioID: obtenerUsuarioActual()?.IDUsuario,
      Estado: 'activa' as const,
      AnuladaEn: null,
      AnuladaPor: null,
      updated_at: ahora(),
      version: 1
    };
    const filas = detalles.map(d => ({ IDDetalle: uuidv4(), IDCompra: idCompra, ...d }));
    await db.compras.add(compra);
    await db.compraDetalle.bulkAdd(filas);
    await encolarCompra(compra, filas);
    return idCompra;
  });
}

export async function anularCompraDB(IDCompra: string): Promise<void> {
  requerirAdmin();
  await db.transaction('rw', [db.materiaPrima, db.compras, db.compraDetalle, db.outbox], async () => {
    const compra = await db.compras.get(IDCompra);
    if (!compra || !activo(compra)) throw new Error('La compra no existe.');
    if (compra.Estado === 'anulada') throw new Error('La compra ya está anulada.');

    const detalles = await db.compraDetalle.where('IDCompra').equals(IDCompra).toArray();
    for (const d of detalles) {
      const m = await db.materiaPrima.get(d.IDItem);
      if (!m) continue;
      if (m.Stock < d.Cantidad) {
        throw new Error(`No se puede anular: de "${m.Nombre}" ya solo quedan ${m.Stock} y la compra sumó ${d.Cantidad}.`);
      }
      await db.materiaPrima.update(d.IDItem, {
        Stock: m.Stock - d.Cantidad,
        updated_at: ahora(),
        version: (m.version ?? 1) + 1
      });
    }

    const actualizada = {
      ...compra,
      Estado: 'anulada' as const,
      AnuladaEn: ahora(),
      AnuladaPor: obtenerUsuarioActual()?.IDUsuario ?? null,
      updated_at: ahora(),
      version: (compra.version ?? 1) + 1
    };
    await db.compras.put(actualizada);
    await encolarCompra(actualizada, detalles);
  });
}

// ---------------------------------------------------------------- calzado

export interface AltaCalzado {
  modelo: string;
  precioBase?: number;
  /** Costo por par. Obligatorio cuando el modelo es nuevo. */
  costoBase?: number;
  tallaDesde: number;
  tallaHasta: number;
  cantidad: number;
}

export async function agregarInventarioCalzadoDB(a: AltaCalzado): Promise<{ modelo: string; modeloNuevo: boolean; tallasNuevas: number; tallasActualizadas: number }> {
  requerirAdmin();
  const modelo = texto(a.modelo, 'El modelo', 40);
  const desde = numero(a.tallaDesde, 'La talla inicial', { entero: true, positivo: true });
  const hasta = numero(a.tallaHasta, 'La talla final', { entero: true, positivo: true });
  if (hasta < desde) throw new Error('La talla final no puede ser menor que la inicial.');
  const cantidad = numero(a.cantidad, 'La cantidad', { entero: true, positivo: true });

  return db.transaction('rw', [db.productos, db.tallas, db.productoCostos, db.outbox], async () => {
    let prod = await db.productos.filter(p => activo(p) && p.Modelo.toLowerCase() === modelo.toLowerCase()).first();
    let modeloNuevo = false;
    let idModelo = '';

    if (!prod) {
      const precio = redondear2(numero(a.precioBase ?? NaN, 'El precio base', { min: 0 }));
      const costo = redondear2(numero(a.costoBase ?? NaN, 'El costo por par', { min: 0 }));
      idModelo = uuidv4();
      prod = { IDModelo: idModelo, Modelo: modelo, PrecioBase: precio, CostoBase: costo, updated_at: ahora(), version: 1 };
      await db.productos.add(prod);
      await encolarProducto(prod);
      await registrarCostoProducto(idModelo, costo);
      modeloNuevo = true;
    } else {
      idModelo = prod.IDModelo;
    }

    let tallasNuevas = 0;
    let tallasActualizadas = 0;
    for (let talla = desde; talla <= hasta; talla++) {
      const existente = await db.tallas.where('[IDModelo+Talla]').equals([idModelo, talla]).filter(activo).first();
      if (existente) {
        const nuevoStock = existente.Stock + cantidad;
        await db.tallas.update(existente.IDTalla, {
          Stock: nuevoStock,
          updated_at: ahora(),
          version: (existente.version ?? 1) + 1
        });
        await encolarAjusteStock(existente.IDTalla, nuevoStock, 'Alta de inventario');
        tallasActualizadas++;
      } else {
        const nueva = {
          IDTalla: uuidv4(),
          IDModelo: idModelo,
          Talla: talla,
          Stock: cantidad,
          updated_at: ahora(),
          version: 1
        };
        await db.tallas.add(nueva);
        await encolarTalla(nueva);
        tallasNuevas++;
      }
    }
    return { modelo: prod!.Modelo, modeloNuevo, tallasNuevas, tallasActualizadas };
  });
}

export async function ajustarStockTallaDB(IDTalla: string, stock: number): Promise<void> {
  requerirAdmin();
  const s = numero(stock, 'La existencia', { entero: true, min: 0 });
  await db.transaction('rw', [db.tallas, db.outbox], async () => {
    const t = await db.tallas.get(IDTalla);
    if (!t || !activo(t)) throw new Error('La talla no existe.');
    await db.tallas.update(IDTalla, { Stock: s, updated_at: ahora(), version: (t.version ?? 1) + 1 });
    await encolarAjusteStock(IDTalla, s, 'Corrección manual');
  });
}

export async function eliminarTallaDB(IDTalla: string): Promise<void> {
  requerirAdmin();
  await db.transaction('rw', [db.tallas, db.ventaDetalle, db.outbox], async () => {
    if ((await db.ventaDetalle.where('IDTalla').equals(IDTalla).count()) > 0) {
      throw new Error('Esa talla ya tiene ventas registradas; no se puede eliminar.');
    }
    const t = await db.tallas.get(IDTalla);
    if (!t) return;
    await db.tallas.update(IDTalla, { deleted_at: ahora(), updated_at: ahora(), version: (t.version ?? 1) + 1 });
    await encolarEliminar('talla', IDTalla);
  });
}

export async function actualizarProductoDB(IDModelo: string, d: { Modelo: string; PrecioBase: number; CostoBase: number }): Promise<void> {
  requerirAdmin();
  const Modelo = texto(d.Modelo, 'El modelo', 40);
  const PrecioBase = redondear2(numero(d.PrecioBase, 'El precio base', { min: 0 }));
  const CostoBase = redondear2(numero(d.CostoBase, 'El costo por par', { min: 0 }));
  await db.transaction('rw', [db.productos, db.productoCostos, db.outbox], async () => {
    const p = await db.productos.get(IDModelo);
    if (!p || !activo(p)) throw new Error('El modelo no existe.');
    const repetido = await db.productos.filter(x => x.IDModelo !== IDModelo && activo(x) && x.Modelo.toLowerCase() === Modelo.toLowerCase()).first();
    if (repetido) throw new Error('Ya existe otro modelo con ese nombre.');
    const actualizado = { ...p, Modelo, PrecioBase, CostoBase, updated_at: ahora(), version: (p.version ?? 1) + 1 };
    await db.productos.put(actualizado);
    await encolarProducto(actualizado);
    if (CostoBase !== (p.CostoBase ?? 0)) await registrarCostoProducto(IDModelo, CostoBase);
  });
}

export async function eliminarProductoDB(IDModelo: string): Promise<void> {
  requerirAdmin();
  await db.transaction('rw', [db.productos, db.tallas, db.ventaDetalle, db.outbox], async () => {
    const tallas = await db.tallas.where('IDModelo').equals(IDModelo).filter(activo).toArray();
    const ids = tallas.map(t => t.IDTalla);
    if (ids.length && (await db.ventaDetalle.where('IDTalla').anyOf(ids).count()) > 0) {
      throw new Error('Este modelo ya tiene ventas registradas; no se puede eliminar.');
    }
    const p = await db.productos.get(IDModelo);
    for (const t of tallas) {
      await db.tallas.update(t.IDTalla, { deleted_at: ahora(), updated_at: ahora(), version: (t.version ?? 1) + 1 });
      await encolarEliminar('talla', t.IDTalla);
    }
    if (p) {
      await db.productos.update(IDModelo, { deleted_at: ahora(), updated_at: ahora(), version: (p.version ?? 1) + 1 });
      await encolarEliminar('producto', IDModelo);
    }
  });
}

// ---------------------------------------------------------------- clientes

export async function crearClienteDB(d: { Nombre: string; Apellido: string; Telefono?: string }): Promise<void> {
  requerirSesion();
  await db.transaction('rw', [db.clientes, db.outbox], async () => {
    const cliente = {
      IDCliente: uuidv4(),
      Nombre: texto(d.Nombre, 'El nombre', 60),
      Apellido: texto(d.Apellido, 'El apellido', 60, false),
      Telefono: texto(d.Telefono, 'El teléfono', 25, false),
      updated_at: ahora(),
      version: 1
    };
    await db.clientes.add(cliente);
    await encolarCliente(cliente);
  });
}

// ---------------------------------------------------------------- proveedores y materiales

export interface DatosProveedor {
  Nombre: string;
  Telefono: string;
  Direccion: string;
  Correo?: string;
}

function limpiarProveedor(d: DatosProveedor): DatosProveedor {
  const correo = texto(d.Correo, 'El correo', 80, false);
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('El correo no es válido.');
  return {
    Nombre: texto(d.Nombre, 'El nombre', 80),
    Telefono: texto(d.Telefono, 'El teléfono', 25, false),
    Direccion: texto(d.Direccion, 'La dirección', 120, false),
    Correo: correo
  };
}

export async function crearProveedorDB(d: DatosProveedor): Promise<void> {
  requerirAdmin();
  await db.transaction('rw', [db.proveedores, db.outbox], async () => {
    const proveedor = { IDProveedor: uuidv4(), ...limpiarProveedor(d), updated_at: ahora(), version: 1 };
    await db.proveedores.add(proveedor);
    await encolarProveedor(proveedor);
  });
}

export async function actualizarProveedorDB(IDProveedor: string, d: DatosProveedor): Promise<void> {
  requerirAdmin();
  await db.transaction('rw', [db.proveedores, db.outbox], async () => {
    const p = await db.proveedores.get(IDProveedor);
    if (!p || !activo(p)) throw new Error('El proveedor no existe.');
    const actualizado = { ...p, ...limpiarProveedor(d), updated_at: ahora(), version: (p.version ?? 1) + 1 };
    await db.proveedores.put(actualizado);
    await encolarProveedor(actualizado);
  });
}

export async function eliminarProveedorDB(IDProveedor: string): Promise<void> {
  requerirAdmin();
  await db.transaction('rw', [db.proveedores, db.compras, db.outbox], async () => {
    if ((await db.compras.where('IDProveedor').equals(IDProveedor).count()) > 0) {
      throw new Error('Este proveedor ya tiene compras registradas; no se puede eliminar.');
    }
    const p = await db.proveedores.get(IDProveedor);
    if (!p) return;
    await db.proveedores.update(IDProveedor, { deleted_at: ahora(), updated_at: ahora(), version: (p.version ?? 1) + 1 });
    await encolarEliminar('proveedor', IDProveedor);
  });
}

export interface DatosMaterial {
  Nombre: string;
  Categoria: string;
  Precio: number;
  Stock: number;
}

function limpiarMaterial(d: DatosMaterial): DatosMaterial {
  return {
    Nombre: texto(d.Nombre, 'El nombre', 80),
    Categoria: texto(d.Categoria, 'La categoría', 60, false),
    Precio: redondear2(numero(d.Precio, 'El precio', { min: 0 })),
    Stock: numero(d.Stock, 'La existencia', { min: 0 })
  };
}

export async function crearMaterialDB(d: DatosMaterial): Promise<void> {
  requerirAdmin();
  await db.transaction('rw', [db.materiaPrima, db.outbox], async () => {
    const material = { IDItem: uuidv4(), ...limpiarMaterial(d), updated_at: ahora(), version: 1 };
    await db.materiaPrima.add(material);
    await encolarMaterial(material);
  });
}

export async function actualizarMaterialDB(IDItem: string, d: DatosMaterial): Promise<void> {
  requerirAdmin();
  await db.transaction('rw', [db.materiaPrima, db.outbox], async () => {
    const m = await db.materiaPrima.get(IDItem);
    if (!m || !activo(m)) throw new Error('El material no existe.');
    const limpio = limpiarMaterial(d);
    const actualizado = { ...m, ...limpio, updated_at: ahora(), version: (m.version ?? 1) + 1 };
    await db.materiaPrima.put(actualizado);
    await encolarMaterial(actualizado);
    if (limpio.Stock !== m.Stock) {
      await encolarAjusteMaterial(IDItem, limpio.Stock, 'Corrección manual');
    }
  });
}

export async function eliminarMaterialDB(IDItem: string): Promise<void> {
  requerirAdmin();
  await db.transaction('rw', [db.materiaPrima, db.compraDetalle, db.outbox], async () => {
    if ((await db.compraDetalle.where('IDItem').equals(IDItem).count()) > 0) {
      throw new Error('Este material ya tiene compras registradas; no se puede eliminar.');
    }
    const m = await db.materiaPrima.get(IDItem);
    if (!m) return;
    await db.materiaPrima.update(IDItem, { deleted_at: ahora(), updated_at: ahora(), version: (m.version ?? 1) + 1 });
    await encolarEliminar('materia_prima', IDItem);
  });
}
