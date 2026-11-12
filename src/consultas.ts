/**
 * consultas.ts
 * ----------------------------------------------------------------------------
 * Lecturas de la base de datos ya "armadas" para las vistas: ventas y compras
 * con su detalle y los nombres resueltos (cliente, modelo, proveedor, material).
 * No modifica datos, por eso no exige permisos especiales.
 */

import { db } from './db.js';

function fechaMs(fecha: Date | string | number | undefined): number {
  if (fecha === undefined || fecha === null) return 0;
  const ms = new Date(fecha).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

const redondear2 = (n: number): number => Math.round(n * 100) / 100;

/** "AAAA-MM" de una fecha, para agrupar por mes. */
export function claveMes(fecha: Date | string): string {
  const f = new Date(fecha);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
}

export interface LineaVentaVista {
  IDDetalle: string;
  IDTalla: string;
  Talla: number | null;
  IDModelo: string | null;
  Modelo: string;
  Cantidad: number;
  PrecioUnitario: number;
  /** Costo del par guardado en la venta (instantánea histórica). */
  CostoUnitario: number;
  CostoTotal: number;
  Utilidad: number;
}

export interface VentaVista {
  IDVenta: string;
  Fecha: Date;
  IDCliente: string;
  Cliente: string;
  Total: number;
  Pares: number;
  CostoTotal: number;
  Utilidad: number;
  /** Pares vendidos sin costo capturado (su utilidad no es confiable). */
  ParesSinCosto: number;
  lineas: LineaVentaVista[];
}

export interface LineaCompraVista {
  IDDetalle: string;
  IDItem: string;
  Material: string;
  Cantidad: number;
  PrecioUnitario: number;
}

export interface CompraVista {
  IDCompra: string;
  Fecha: Date;
  IDProveedor: string;
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

  const modelos = new Map(productos.map(p => [p.IDModelo, p.Modelo]));
  const costoModelo = new Map(productos.map(p => [p.IDModelo, Number(p.CostoBase ?? 0)]));
  const mapaTallas = new Map(tallas.map(t => [t.IDTalla, t]));
  const nombres = new Map(clientes.map(c => [c.IDCliente, `${c.Nombre} ${c.Apellido}`.trim()]));

  const porVenta = new Map<string, LineaVentaVista[]>();
  for (const d of detalles) {
    const t = mapaTallas.get(d.IDTalla);
    // Si la línea no trae costo (venta antigua), se usa el costo vigente del
    // modelo como mejor aproximación; las ventas nuevas siempre lo guardan.
    const costo = Number.isFinite(d.CostoUnitario)
      ? Number(d.CostoUnitario)
      : Number(t ? (costoModelo.get(t.IDModelo) ?? 0) : 0);
    const importe = redondear2(d.Cantidad * d.PrecioUnitario);
    const costoTotal = redondear2(d.Cantidad * costo);
    const linea: LineaVentaVista = {
      IDDetalle: d.IDDetalle as string,
      IDTalla: d.IDTalla,
      Talla: t?.Talla ?? null,
      IDModelo: t?.IDModelo ?? null,
      Modelo: t ? (modelos.get(t.IDModelo) ?? `#${t.IDModelo}`) : 'S/M',
      Cantidad: d.Cantidad,
      PrecioUnitario: d.PrecioUnitario,
      CostoUnitario: redondear2(costo),
      CostoTotal: costoTotal,
      Utilidad: redondear2(importe - costoTotal)
    };
    const lista = porVenta.get(d.IDVenta) ?? [];
    lista.push(linea);
    porVenta.set(d.IDVenta, lista);
  }

  return ventas
    .filter(v => !v.deleted_at && v.Estado !== 'anulada')
    .map(v => {
      const lineas = (porVenta.get(v.IDVenta) ?? []).sort((a, b) => (a.Talla ?? 0) - (b.Talla ?? 0));
      const total = Number.isFinite(v.Total) ? v.Total : 0;
      const costoTotal = redondear2(lineas.reduce((acc, l) => acc + l.CostoTotal, 0));
      return {
        IDVenta: v.IDVenta,
        Fecha: new Date(v.Fecha),
        IDCliente: v.IDCliente,
        Cliente: nombres.get(v.IDCliente) ?? 'Venta directa',
        Total: total,
        Pares: lineas.reduce((acc, l) => acc + l.Cantidad, 0),
        CostoTotal: costoTotal,
        Utilidad: redondear2(total - costoTotal),
        ParesSinCosto: lineas.filter(l => l.CostoUnitario <= 0).reduce((acc, l) => acc + l.Cantidad, 0),
        lineas
      };
    })
    .sort((a, b) => fechaMs(b.Fecha) - fechaMs(a.Fecha));
}

/** Todas las compras con su detalle, de la más reciente a la más antigua. */
export async function obtenerComprasVista(): Promise<CompraVista[]> {
  const [compras, detalles, materiales, proveedores] = await Promise.all([
    db.compras.toArray(),
    db.compraDetalle.toArray(),
    db.materiaPrima.toArray(),
    db.proveedores.toArray()
  ]);

  const nombresMat = new Map(materiales.map(m => [m.IDItem as string, m.Nombre]));
  const nombresProv = new Map(proveedores.map(p => [p.IDProveedor as string, p.Nombre]));

  const porCompra = new Map<string, LineaCompraVista[]>();
  for (const d of detalles) {
    const lista = porCompra.get(d.IDCompra) ?? [];
    lista.push({
      IDDetalle: d.IDDetalle as string,
      IDItem: d.IDItem,
      Material: nombresMat.get(d.IDItem) ?? 'Insumo',
      Cantidad: d.Cantidad,
      PrecioUnitario: d.PrecioUnitario
    });
    porCompra.set(d.IDCompra, lista);
  }

  return compras
    .filter(c => !c.deleted_at && c.Estado !== 'anulada')
    .map(c => ({
      IDCompra: c.IDCompra as string,
      Fecha: new Date(c.Fecha),
      IDProveedor: c.IDProveedor,
      Proveedor: nombresProv.get(c.IDProveedor) ?? 'Proveedor',
      Total: Number.isFinite(c.Total) ? c.Total : 0,
      lineas: porCompra.get(c.IDCompra) ?? []
    }))
    .sort((a, b) => fechaMs(b.Fecha) - fechaMs(a.Fecha));
}

export interface BalanceVista {
  totalIngresos: number;
  /** Costo de las unidades vendidas (COGS), no las compras del periodo. */
  totalCostoVentas: number;
  /** Compras del periodo: inversión en inventario, informativa. */
  totalCompras: number;
  utilidadNeta: number;
  paresSinCosto: number;
}

/**
 * Balance de un mes (o de todo el historial si no se indica mes).
 * La utilidad neta es ingresos menos el costo de lo vendido; las compras no
 * se restan porque son inversión en inventario, no un gasto del periodo.
 */
export async function obtenerBalanceDB(mes?: string): Promise<BalanceVista> {
  const [ventas, compras] = await Promise.all([obtenerVentasVista(), obtenerComprasVista()]);
  const delMes = (fecha: Date): boolean => !mes || claveMes(fecha) === mes;

  const ventasMes = ventas.filter(v => delMes(v.Fecha));
  const comprasMes = compras.filter(c => delMes(c.Fecha));

  const totalIngresos = redondear2(ventasMes.reduce((acc, v) => acc + v.Total, 0));
  const totalCostoVentas = redondear2(ventasMes.reduce((acc, v) => acc + v.CostoTotal, 0));
  const totalCompras = redondear2(comprasMes.reduce((acc, c) => acc + c.Total, 0));
  const paresSinCosto = ventasMes.reduce((acc, v) => acc + v.ParesSinCosto, 0);

  return {
    totalIngresos,
    totalCostoVentas,
    totalCompras,
    utilidadNeta: redondear2(totalIngresos - totalCostoVentas),
    paresSinCosto
  };
}