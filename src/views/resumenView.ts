/**
 * resumenView.ts
 * ----------------------------------------------------------------------------
 * Vista "Resumen del mes".
 *
 * Responsabilidades:
 *  - Filtrar ventas y compras por el mes elegido en el selector.
 *  - Mostrar ventas, compras, utilidad y pares vendidos de ese mes.
 *  - Mostrar el ranking de modelos más vendidos del mes.
 *  - Manejar el botón de imprimir.
 *
 * Elementos del HTML que utiliza:
 *  #r-mes (input type="month"), #r-ventas, #r-compras, #r-utilidad, #r-pares,
 *  #r-top-modelos (contenedor del ranking), #btn-imprimir
 */

import { db } from '../db.js';
import { formatearDinero } from '../utils.js';

/** Cuántos modelos se muestran en el ranking. */
const TOP_MODELOS = 5;

/** Devuelve "AAAA-MM" para una fecha (zona horaria local). */
function claveMes(fecha: Date): string {
  const f = new Date(fecha);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
}

/** Mes seleccionado en el input; si está vacío, usa el mes actual. */
function mesSeleccionado(): string {
  const input = document.getElementById('r-mes') as HTMLInputElement | null;
  return input?.value || claveMes(new Date());
}

/** Asigna texto a un elemento por id (si existe). */
function setTexto(id: string, texto: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = texto;
}

/** Refresca el balance y el ranking para el mes seleccionado. */
export async function renderResumenView(): Promise<void> {
  const mes = mesSeleccionado();

  const [todasVentas, todasCompras, tallas, productos] = await Promise.all([
    db.ventas.toArray(),
    db.compras.toArray(),
    db.tallas.toArray(),
    db.productos.toArray()
  ]);

  const ventas = todasVentas.filter(v => claveMes(v.Fecha) === mes);
  const compras = todasCompras.filter(c => claveMes(c.Fecha) === mes);

  // --- Balance del mes ---
  const ingresos = ventas.reduce((acc, v) => acc + v.Cantidad * v.PrecioUnitario, 0);
  const gastos = compras.reduce((acc, c) => acc + c.Costo, 0);
  const paresVendidos = ventas.reduce((acc, v) => acc + v.Cantidad, 0);

  setTexto('r-ventas', formatearDinero(ingresos));
  setTexto('r-compras', formatearDinero(gastos));
  setTexto('r-utilidad', formatearDinero(ingresos - gastos));
  setTexto('r-pares', `${paresVendidos}`);

  // --- Modelos más vendidos ---
  const contenedor = document.getElementById('r-top-modelos');
  if (!contenedor) return;

  const mapaProductos = new Map(productos.map(p => [p.IDModelo, p.Modelo]));
  const mapaTallas = new Map(tallas.map(t => [t.IDTalla, t.IDModelo]));

  // Acumular pares e ingresos por modelo
  const porModelo = new Map<number, { pares: number; ingresos: number }>();
  for (const v of ventas) {
    const idModelo = mapaTallas.get(v.IDTalla);
    if (idModelo === undefined) continue;
    const acc = porModelo.get(idModelo) ?? { pares: 0, ingresos: 0 };
    acc.pares += v.Cantidad;
    acc.ingresos += v.Cantidad * v.PrecioUnitario;
    porModelo.set(idModelo, acc);
  }

  const ranking = [...porModelo.entries()]
    .sort((a, b) => b[1].pares - a[1].pares)
    .slice(0, TOP_MODELOS);

  if (ranking.length === 0) {
    contenedor.innerHTML = '<p class="muted">Sin ventas en este mes.</p>';
    return;
  }

  contenedor.innerHTML = ranking.map(([idModelo, datos], i) => `
    <div class="resumen-linea">
      <span>${i + 1}. Modelo ${mapaProductos.get(idModelo) ?? `#${idModelo}`}</span>
      <strong>${datos.pares} pares · ${formatearDinero(datos.ingresos)}</strong>
    </div>`).join('');
}

/** Registra los eventos: cambio de mes e impresión. */
export function inicializarResumenView(): void {
  const inputMes = document.getElementById('r-mes') as HTMLInputElement | null;
  if (inputMes) {
    if (!inputMes.value) inputMes.value = claveMes(new Date());
    inputMes.addEventListener('change', () => renderResumenView());
  }

  document.getElementById('btn-imprimir')?.addEventListener('click', () => window.print());
}