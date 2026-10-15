/**
 * consultas.ts
 * ----------------------------------------------------------------------------
 * Lecturas de la base de datos ya "armadas" para las vistas: ventas y compras
 * con su detalle y los nombres resueltos (cliente, modelo, proveedor, material).
 * No modifica datos, por eso no exige permisos especiales.
 */

import { db } from './db.js';

export interface LineaVentaVista {
  IDDetalle: number;
  IDTalla: number;
  Talla: number | null;
  IDModelo: number | null;
  Modelo: string;
  Cantidad: number;
  PrecioUnitario: number;
}

export interface VentaVista {
  IDVenta: number;
  Fecha: Date;
  IDCliente: number;
  Cliente: string;
  Total: number;
  Pares: number;
  lineas: LineaVentaVista[];
}

export interface LineaCompraVista {
  IDDetalle: number;
  IDItem: number;
  Material: string;
  Cantidad: number;
  PrecioUnitario: number;
}

export interface CompraVista {
  IDCompra: number;
  Fecha: Date;
  IDProveedor: number;
  Proveedor: string;
  Total: number;
  lineas: LineaCompraVista[];
}

/** Todas las ventas con su detalle, de la más reciente a la más antigua. */
export async function obtenerVentasVista(): Promise<VentaVista[]> {
  const [ventas, detalles, tallas, productos, clientes] = await Promise.all([
    db.ventas.toArray(),
    db.ventaDetalle.toArray(),
    db.tallas.toArray(),
    db.productos.toArray(),
    db.clientes.toArray()
  ]);

  const modelos = new Map(productos.map(p => [p.IDModelo as number, p.Modelo]));
  const mapaTallas = new Map(tallas.map(t => [t.IDTalla as number, t]));
  const nombres = new Map(clientes.map(c => [c.IDCliente as number, `${c.Nombre} ${c.Apellido}`.trim()]));

  const porVenta = new Map<number, LineaVentaVista[]>();
  for (const d of detalles) {
    const t = mapaTallas.get(d.IDTalla);
    const linea: LineaVentaVista = {
      IDDetalle: d.IDDetalle as number,
      IDTalla: d.IDTalla,
      Talla: t?.Talla ?? null,
      IDModelo: t?.IDModelo ?? null,
      Modelo: t ? (modelos.get(t.IDModelo) ?? `#${t.IDModelo}`) : 'S/M',
      Cantidad: d.Cantidad,
      PrecioUnitario: d.PrecioUnitario
    };
    const lista = porVenta.get(d.IDVenta) ?? [];
    lista.push(linea);
    porVenta.set(d.IDVenta, lista);
  }

  return ventas
    .map(v => {
      const lineas = (porVenta.get(v.IDVenta as number) ?? []).sort((a, b) => (a.Talla ?? 0) - (b.Talla ?? 0));
      return {
        IDVenta: v.IDVenta as number,
        Fecha: v.Fecha,
        IDCliente: v.IDCliente,
        Cliente: nombres.get(v.IDCliente) ?? 'Venta directa',
        Total: v.Total,
        Pares: lineas.reduce((acc, l) => acc + l.Cantidad, 0),
        lineas
      };
    })
    .sort((a, b) => new Date(b.Fecha).getTime() - new Date(a.Fecha).getTime());
}

/** Todas las compras con su detalle, de la más reciente a la más antigua. */
export async function obtenerComprasVista(): Promise<CompraVista[]> {
  const [compras, detalles, materiales, proveedores] = await Promise.all([
    db.compras.toArray(),
    db.compraDetalle.toArray(),
    db.materiaPrima.toArray(),
    db.proveedores.toArray()
  ]);

  const nombresMat = new Map(materiales.map(m => [m.IDItem as number, m.Nombre]));
  const nombresProv = new Map(proveedores.map(p => [p.IDProveedor as number, p.Nombre]));

  const porCompra = new Map<number, LineaCompraVista[]>();
  for (const d of detalles) {
    const lista = porCompra.get(d.IDCompra) ?? [];
    lista.push({
      IDDetalle: d.IDDetalle as number,
      IDItem: d.IDItem,
      Material: nombresMat.get(d.IDItem) ?? 'Insumo',
      Cantidad: d.Cantidad,
      PrecioUnitario: d.PrecioUnitario
    });
    porCompra.set(d.IDCompra, lista);
  }

  return compras
    .map(c => ({
      IDCompra: c.IDCompra as number,
      Fecha: c.Fecha,
      IDProveedor: c.IDProveedor,
      Proveedor: nombresProv.get(c.IDProveedor) ?? 'Proveedor',
      Total: c.Total,
      lineas: porCompra.get(c.IDCompra as number) ?? []
    }))
    .sort((a, b) => new Date(b.Fecha).getTime() - new Date(a.Fecha).getTime());
}

/** Balance general (todo el historial). */
export async function obtenerBalanceDB(): Promise<{ totalIngresos: number; totalGastos: number; utilidadNeta: number }> {
  const [ventas, compras] = await Promise.all([db.ventas.toArray(), db.compras.toArray()]);
  const totalIngresos = ventas.reduce((acc, v) => acc + v.Total, 0);
  const totalGastos = compras.reduce((acc, c) => acc + c.Total, 0);
  return { totalIngresos, totalGastos, utilidadNeta: totalIngresos - totalGastos };
}