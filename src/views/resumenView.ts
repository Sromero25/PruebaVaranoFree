/**
 * resumenView.ts
 * ----------------------------------------------------------------------------
 * Vista "Resumen del mes": balance y ranking de modelos del mes elegido.
 * Ids: #r-mes, #r-ventas, #r-compras, #r-utilidad, #r-pares, #r-top-modelos,
 * #btn-imprimir.
 */

import { claveMes, obtenerVentasVista, obtenerComprasVista } from '../consultas.js';
import { el, esc, formatearDinero } from '../herramientas.js';

const TOP_MODELOS = 5;

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
  const costoVentas = ventas.reduce((acc, v) => acc + v.CostoTotal, 0);
  const comprasInversion = compras.reduce((acc, c) => acc + c.Total, 0);
  const paresSinCosto = ventas.reduce((acc, v) => acc + v.ParesSinCosto, 0);

  setTexto('r-ventas', formatearDinero(ingresos));
  setTexto('r-costo', formatearDinero(costoVentas));
  setTexto('r-compras', formatearDinero(comprasInversion));
  setTexto('r-utilidad', formatearDinero(ingresos - costoVentas));
  setTexto('r-pares', `${ventas.reduce((acc, v) => acc + v.Pares, 0)}`);

  const aviso = el('r-aviso-costo');
  if (aviso) {
    aviso.hidden = paresSinCosto === 0;
    aviso.textContent = paresSinCosto > 0
      ? `Atención: ${paresSinCosto} pares vendidos no tienen costo registrado; la utilidad mostrada es mayor a la real.`
      : '';
  }

  const cont = el('r-top-modelos');
  if (!cont) return;

  const porModelo = new Map<string, { pares: number; ingresos: number; utilidad: number }>();
  for (const v of ventas) {
    for (const l of v.lineas) {
      const acc = porModelo.get(l.Modelo) ?? { pares: 0, ingresos: 0, utilidad: 0 };
      acc.pares += l.Cantidad;
      acc.ingresos += l.Cantidad * l.PrecioUnitario;
      acc.utilidad += l.Utilidad;
      porModelo.set(l.Modelo, acc);
    }
  }
  const ranking = [...porModelo.entries()].sort((a, b) => b[1].pares - a[1].pares).slice(0, TOP_MODELOS);

  cont.innerHTML = ranking.length === 0
    ? '<p class="muted">Sin ventas en este mes.</p>'
    : ranking.map(([modelo, d], i) => `<div class="resumen-linea">
        <span>${i + 1}. Modelo ${esc(modelo)}</span><strong>${d.pares} pares · ${formatearDinero(d.ingresos)} · utilidad ${formatearDinero(d.utilidad)}</strong></div>`).join('');
}

export function inicializarResumenView(): void {
  const input = el<HTMLInputElement>('r-mes');
  if (input) {
    if (!input.value) input.value = claveMes(new Date());
    input.addEventListener('change', () => void renderResumenView());
  }
  el('btn-imprimir')?.addEventListener('click', () => window.print());
}