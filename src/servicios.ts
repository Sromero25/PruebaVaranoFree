/**
 * servicios.ts
 * ----------------------------------------------------------------------------
 * Operaciones que MODIFICAN la base de datos. Cada una:
 *  - exige sesión (o rol admin cuando es una corrección),
 *  - valida y sanea sus datos,
 *  - usa transacciones (si algo falla, no queda nada a medias),
 *  - lanza un Error con mensaje claro (las vistas lo muestran en pantalla).
 *
 * Seguridad: IndexedDB no usa SQL, así que no existe inyección SQL. Los datos
 * se guardan como valores, nunca se arman consultas con texto del usuario.
 */

import { db } from './db.js';
import { requerirAdmin, requerirSesion } from './auth.js'

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

// ---------------------------------------------------------------- ventas

export interface LineaVenta {
  IDTalla: number;
  Cantidad: number;
  PrecioUnitario: number;
}

/** Registra una venta con una o varias tallas y descuenta el stock. Devuelve el ID de venta. */
export async function registrarVentaDB(IDCliente: number, lineas: LineaVenta[]): Promise<number> {
  requerirSesion();
  if (lineas.length === 0) throw new Error('Agrega al menos un par a la venta.');

  const limpias = lineas.map(l => ({
    IDTalla: numero(l.IDTalla, 'Talla', { entero: true }),
    Cantidad: numero(l.Cantidad, 'Cantidad', { entero: true, positivo: true }),
    PrecioUnitario: redondear2(numero(l.PrecioUnitario, 'Precio', { min: 0 }))
  }));

  return db.transaction('rw', [db.clientes, db.tallas, db.ventas, db.ventaDetalle], async () => {
    if (!(await db.clientes.get(IDCliente))) throw new Error('El cliente no existe.');

    // Sumar lo pedido por talla (por si hay líneas repetidas) y validar existencias
    const pedidos = new Map<number, number>();
    for (const l of limpias) pedidos.set(l.IDTalla, (pedidos.get(l.IDTalla) ?? 0) + l.Cantidad);

    for (const [idTalla, cant] of pedidos) {
      const t = await db.tallas.get(idTalla);
      if (!t) throw new Error('Una de las tallas ya no existe.');
      if (t.Stock < cant) throw new Error(`Stock insuficiente en talla ${t.Talla}: quedan ${t.Stock} pares.`);
      await db.tallas.update(idTalla, { Stock: t.Stock - cant });
    }

    const total = redondear2(limpias.reduce((acc, l) => acc + l.Cantidad * l.PrecioUnitario, 0));
    const idVenta = await db.ventas.add({ IDCliente, Fecha: new Date(), Total: total });
    await db.ventaDetalle.bulkAdd(limpias.map(l => ({ IDVenta: idVenta, ...l })));
    return idVenta;
  });
}

export interface CorreccionVenta {
  IDCliente: number;
  Fecha: Date;
  /** Cantidad 0 = quitar esa línea (el stock se devuelve). */
  lineas: { IDDetalle: number; Cantidad: number; PrecioUnitario: number }[];
}

/** (Admin) Corrige cliente, fecha, cantidades y precios de una venta ajustando el stock. */
export async function corregirVentaDB(IDVenta: number, c: CorreccionVenta): Promise<void> {
  requerirAdmin();
  if (Number.isNaN(new Date(c.Fecha).getTime())) throw new Error('La fecha no es válida.');
  const cambios = new Map(c.lineas.map(l => [l.IDDetalle, {
    Cantidad: numero(l.Cantidad, 'Cantidad', { entero: true, min: 0 }),
    PrecioUnitario: redondear2(numero(l.PrecioUnitario, 'Precio', { min: 0 }))
  }]));

  await db.transaction('rw', [db.clientes, db.tallas, db.ventas, db.ventaDetalle], async () => {
    if (!(await db.ventas.get(IDVenta))) throw new Error('La venta no existe.');
    if (!(await db.clientes.get(c.IDCliente))) throw new Error('El cliente no existe.');

    const detalles = await db.ventaDetalle.where('IDVenta').equals(IDVenta).toArray();

    // Diferencia de pares por talla (positivo = se vende más)
    const delta = new Map<number, number>();
    for (const d of detalles) {
      const nuevo = cambios.get(d.IDDetalle as number);
      if (!nuevo) continue;
      delta.set(d.IDTalla, (delta.get(d.IDTalla) ?? 0) + nuevo.Cantidad - d.Cantidad);
    }
    for (const [idTalla, dif] of delta) {
      if (dif === 0) continue;
      const t = await db.tallas.get(idTalla);
      if (!t) throw new Error('Una de las tallas ya no existe.');
      if (t.Stock - dif < 0) throw new Error(`Stock insuficiente en talla ${t.Talla} para ese cambio.`);
      await db.tallas.update(idTalla, { Stock: t.Stock - dif });
    }

    let total = 0;
    let restantes = 0;
    for (const d of detalles) {
      const nuevo = cambios.get(d.IDDetalle as number) ?? { Cantidad: d.Cantidad, PrecioUnitario: d.PrecioUnitario };
      if (nuevo.Cantidad === 0) {
        await db.ventaDetalle.delete(d.IDDetalle as number);
      } else {
        await db.ventaDetalle.update(d.IDDetalle as number, nuevo);
        total += nuevo.Cantidad * nuevo.PrecioUnitario;
        restantes++;
      }
    }
    if (restantes === 0) throw new Error('La venta quedaría sin productos. Usa "Anular" para eliminarla.');

    await db.ventas.update(IDVenta, { IDCliente: c.IDCliente, Fecha: c.Fecha, Total: redondear2(total) });
  });
}

/** (Admin) Anula una venta y devuelve los pares al inventario. */
export async function anularVentaDB(IDVenta: number): Promise<void> {
  requerirAdmin();
  await db.transaction('rw', [db.tallas, db.ventas, db.ventaDetalle], async () => {
    const detalles = await db.ventaDetalle.where('IDVenta').equals(IDVenta).toArray();
    for (const d of detalles) {
      const t = await db.tallas.get(d.IDTalla);
      if (t) await db.tallas.update(d.IDTalla, { Stock: t.Stock + d.Cantidad });
    }
    await db.ventaDetalle.where('IDVenta').equals(IDVenta).delete();
    await db.ventas.delete(IDVenta);
  });
}

// ---------------------------------------------------------------- compras

export interface LineaCompra {
  IDItem: number;
  Cantidad: number;
}

/**
 * Registra una compra de varios materiales. El costo se calcula solo con el
 * precio guardado en cada material (queda congelado en la compra).
 */
export async function registrarCompraDB(IDProveedor: number, lineas: LineaCompra[]): Promise<number> {
  requerirSesion();
  if (lineas.length === 0) throw new Error('Agrega al menos un material a la compra.');

  const pedidos = new Map<number, number>();
  for (const l of lineas) {
    const cant = numero(l.Cantidad, 'Cantidad', { positivo: true });
    pedidos.set(l.IDItem, (pedidos.get(l.IDItem) ?? 0) + cant);
  }

  return db.transaction('rw', [db.proveedores, db.materiaPrima, db.compras, db.compraDetalle], async () => {
    if (!(await db.proveedores.get(IDProveedor))) throw new Error('El proveedor no existe.');

    const detalles: { IDItem: number; Cantidad: number; PrecioUnitario: number }[] = [];
    let total = 0;
    for (const [idItem, cant] of pedidos) {
      const m = await db.materiaPrima.get(idItem);
      if (!m) throw new Error('Uno de los materiales ya no existe.');
      if (!(m.Precio > 0)) throw new Error(`"${m.Nombre}" no tiene precio. Pide al administrador que lo registre.`);
      await db.materiaPrima.update(idItem, { Stock: m.Stock + cant });
      detalles.push({ IDItem: idItem, Cantidad: cant, PrecioUnitario: m.Precio });
      total += cant * m.Precio;
    }

    const idCompra = await db.compras.add({ IDProveedor, Fecha: new Date(), Total: redondear2(total) });
    await db.compraDetalle.bulkAdd(detalles.map(d => ({ IDCompra: idCompra, ...d })));
    return idCompra;
  });
}

/** (Admin) Anula una compra y descuenta el material que había sumado. */
export async function anularCompraDB(IDCompra: number): Promise<void> {
  requerirAdmin();
  await db.transaction('rw', [db.materiaPrima, db.compras, db.compraDetalle], async () => {
    const detalles = await db.compraDetalle.where('IDCompra').equals(IDCompra).toArray();
    for (const d of detalles) {
      const m = await db.materiaPrima.get(d.IDItem);
      if (!m) continue;
      if (m.Stock < d.Cantidad) {
        throw new Error(`No se puede anular: de "${m.Nombre}" ya solo quedan ${m.Stock} y la compra sumó ${d.Cantidad}.`);
      }
      await db.materiaPrima.update(d.IDItem, { Stock: m.Stock - d.Cantidad });
    }
    await db.compraDetalle.where('IDCompra').equals(IDCompra).delete();
    await db.compras.delete(IDCompra);
  });
}

// ---------------------------------------------------------------- calzado

export interface AltaCalzado {
  modelo: string;
  /** Sólo necesario si el modelo es nuevo. */
  precioBase?: number;
  tallaDesde: number;
  tallaHasta: number;
  /** Pares que se suman a cada talla del rango. */
  cantidad: number;
}

/**
 * Da de alta (o suma existencias a) un modelo en un rango de tallas.
 * Si el modelo no existe lo crea; si la talla ya existe, le suma pares.
 */
export async function agregarInventarioCalzadoDB(a: AltaCalzado): Promise<{ modelo: string; modeloNuevo: boolean; tallasNuevas: number; tallasActualizadas: number }> {
  requerirSesion();
  const modelo = texto(a.modelo, 'El modelo', 40);
  const desde = numero(a.tallaDesde, 'La talla inicial', { entero: true, positivo: true });
  const hasta = numero(a.tallaHasta, 'La talla final', { entero: true, positivo: true });
  if (hasta < desde) throw new Error('La talla final no puede ser menor que la inicial.');
  if (hasta - desde > 60) throw new Error('El rango de tallas es demasiado grande.');
  const cantidad = numero(a.cantidad, 'La cantidad', { entero: true, positivo: true });

  return db.transaction('rw', [db.productos, db.tallas], async () => {
    let prod = await db.productos.filter(p => p.Modelo.toLowerCase() === modelo.toLowerCase()).first();
    let modeloNuevo = false;
    if (!prod) {
      const precio = redondear2(numero(a.precioBase ?? NaN, 'El precio base', { min: 0 }));
      const id = await db.productos.add({ Modelo: modelo, PrecioBase: precio });
      prod = { IDModelo: id, Modelo: modelo, PrecioBase: precio };
      modeloNuevo = true;
    }
    const idModelo = prod.IDModelo as number;

    let tallasNuevas = 0;
    let tallasActualizadas = 0;
    for (let talla = desde; talla <= hasta; talla++) {
      const existente = await db.tallas.where('[IDModelo+Talla]').equals([idModelo, talla]).first();
      if (existente) {
        await db.tallas.update(existente.IDTalla as number, { Stock: existente.Stock + cantidad });
        tallasActualizadas++;
      } else {
        await db.tallas.add({ IDModelo: idModelo, Talla: talla, Stock: cantidad });
        tallasNuevas++;
      }
    }
    return { modelo: prod.Modelo, modeloNuevo, tallasNuevas, tallasActualizadas };
  });
}

/** (Admin) Fija la existencia exacta de una talla (corrección de inventario). */
export async function ajustarStockTallaDB(IDTalla: number, stock: number): Promise<void> {
  requerirAdmin();
  const s = numero(stock, 'La existencia', { entero: true, min: 0 });
  if ((await db.tallas.update(IDTalla, { Stock: s })) === 0) throw new Error('La talla no existe.');
}

/** (Admin) Elimina una talla; se bloquea si ya tiene ventas registradas. */
export async function eliminarTallaDB(IDTalla: number): Promise<void> {
  requerirAdmin();
  if ((await db.ventaDetalle.where('IDTalla').equals(IDTalla).count()) > 0) {
    throw new Error('Esa talla ya tiene ventas registradas; no se puede eliminar. Puedes dejar su existencia en 0.');
  }
  await db.tallas.delete(IDTalla);
}

/** (Admin) Corrige nombre y precio base de un modelo. */
export async function actualizarProductoDB(IDModelo: number, d: { Modelo: string; PrecioBase: number }): Promise<void> {
  requerirAdmin();
  const Modelo = texto(d.Modelo, 'El modelo', 40);
  const PrecioBase = redondear2(numero(d.PrecioBase, 'El precio base', { min: 0 }));
  const repetido = await db.productos.filter(p => p.IDModelo !== IDModelo && p.Modelo.toLowerCase() === Modelo.toLowerCase()).first();
  if (repetido) throw new Error('Ya existe otro modelo con ese nombre.');
  await db.productos.update(IDModelo, { Modelo, PrecioBase });
}

/** (Admin) Elimina un modelo con todas sus tallas; se bloquea si alguna talla tiene ventas. */
export async function eliminarProductoDB(IDModelo: number): Promise<void> {
  requerirAdmin();
  await db.transaction('rw', [db.productos, db.tallas, db.ventaDetalle], async () => {
    const ids = (await db.tallas.where('IDModelo').equals(IDModelo).toArray()).map(t => t.IDTalla as number);
    if ((await db.ventaDetalle.where('IDTalla').anyOf(ids).count()) > 0) {
      throw new Error('Este modelo ya tiene ventas registradas; no se puede eliminar.');
    }
    await db.tallas.bulkDelete(ids);
    await db.productos.delete(IDModelo);
  });
}

// ---------------------------------------------------------------- clientes

export async function crearClienteDB(d: { Nombre: string; Apellido: string; Telefono?: string }): Promise<void> {
  requerirSesion();
  await db.clientes.add({
    Nombre: texto(d.Nombre, 'El nombre', 60),
    Apellido: texto(d.Apellido, 'El apellido', 60, false),
    Telefono: texto(d.Telefono, 'El teléfono', 25, false)
  });
}

// ---------------------------------------------------------------- proveedores (admin)

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
  await db.proveedores.add(limpiarProveedor(d));
}

export async function actualizarProveedorDB(IDProveedor: number, d: DatosProveedor): Promise<void> {
  requerirAdmin();
  await db.proveedores.update(IDProveedor, limpiarProveedor(d));
}

export async function eliminarProveedorDB(IDProveedor: number): Promise<void> {
  requerirAdmin();
  if ((await db.compras.where('IDProveedor').equals(IDProveedor).count()) > 0) {
    throw new Error('Este proveedor ya tiene compras registradas; no se puede eliminar.');
  }
  await db.proveedores.delete(IDProveedor);
}

// ---------------------------------------------------------------- materiales (admin)

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
  await db.materiaPrima.add(limpiarMaterial(d));
}

export async function actualizarMaterialDB(IDItem: number, d: DatosMaterial): Promise<void> {
  requerirAdmin();
  await db.materiaPrima.update(IDItem, limpiarMaterial(d));
}

export async function eliminarMaterialDB(IDItem: number): Promise<void> {
  requerirAdmin();
  if ((await db.compraDetalle.where('IDItem').equals(IDItem).count()) > 0) {
    throw new Error('Este material ya tiene compras registradas; no se puede eliminar.');
  }
  await db.materiaPrima.delete(IDItem);
}