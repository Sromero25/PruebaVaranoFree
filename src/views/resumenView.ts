/**
 * resumenView.ts
 * ----------------------------------------------------------------------------
 * Vista "Resumen del mes": balance y ranking de modelos del mes elegido.
 * Ids: #r-mes, #r-ventas, #r-compras, #r-utilidad, #r-pares, #r-top-modelos,
 * #btn-imprimir.
 */

import { obtenerVentasVista, obtenerComprasVista } from '../consultas.js';
import { el, esc, formatearDinero } from '../herramientas.js';

const TOP_MODELOS = 5;

function claveMes(fecha: Date): string {
  const f = new Date(fecha);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
}

function setTexto(id: string, texto: string): void {
  const e = el(id);
  if (e) e.textContent = texto;
}

export async function renderResumenView(): Promise<void> {
  const mes = el<HTMLInputElement>('r-mes')?.value || claveMes(new Date());
  const [todasVentas, todasCompras] = await Promise.all([obtenerVentasVista(), obtenerComprasVista()]);
  const ventas = todasVentas.filter(v => claveMes(v.Fecha) === mes);
  const compras = todasCompras.filter(c => claveMes(c.Fecha) === mes);

  const ingresos = ventas.reduce((acc, v) => acc + v.Total, 0);
  const gastos = compras.reduce((acc, c) => acc + c.Total, 0);

  setTexto('r-ventas', formatearDinero(ingresos));
  setTexto('r-compras', formatearDinero(gastos));
  setTexto('r-utilidad', formatearDinero(ingresos - gastos));
  setTexto('r-pares', `${ventas.reduce((acc, v) => acc + v.Pares, 0)}`);

  const cont = el('r-top-modelos');
  if (!cont) return;

  const porModelo = new Map<string, { pares: number; ingresos: number }>();
  for (const v of ventas) {
    for (const l of v.lineas) {
      const acc = porModelo.get(l.Modelo) ?? { pares: 0, ingresos: 0 };
      acc.pares += l.Cantidad;
      acc.ingresos += l.Cantidad * l.PrecioUnitario;
      porModelo.set(l.Modelo, acc);
    }
  }
  const ranking = [...porModelo.entries()].sort((a, b) => b[1].pares - a[1].pares).slice(0, TOP_MODELOS);

  cont.innerHTML = ranking.length === 0
    ? '<p class="muted">Sin ventas en este mes.</p>'
    : ranking.map(([modelo, d], i) => `<div class="resumen-linea">
        <span>${i + 1}. Modelo ${esc(modelo)}</span><strong>${d.pares} pares · ${formatearDinero(d.ingresos)}</strong></div>`).join('');
}

export function inicializarResumenView(): void {
  const input = el<HTMLInputElement>('r-mes');
  if (input) {
    if (!input.value) input.value = claveMes(new Date());
    input.addEventListener('change', () => void renderResumenView());
  }
  el('btn-imprimir')?.addEventListener('click', () => window.print());
}