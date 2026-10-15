/**
 * inicioView.ts
 * ----------------------------------------------------------------------------
 * Vista "Inicio": KPIs, últimas 5 ventas y alertas de stock bajo.
 * Usa los ids del HTML original: #txt-ventas, #txt-compras, #txt-utilidad,
 * #txt-pares, #tabla-ultimas-ventas, #lista-stock-bajo.
 */

import { db } from '../db.js';
import { obtenerBalanceDB, obtenerVentasVista } from '../consultas.js';
import { el, esc, formatearDinero, formatearFecha, UMBRAL_STOCK_BAJO } from '../herramientas.js';

function setTexto(id: string, texto: string): void {
  const e = el(id);
  if (e) e.textContent = texto;
}

export async function renderInicioView(): Promise<void> {
  const [tallas, productos, balance, ventas] = await Promise.all([
    db.tallas.toArray(), db.productos.toArray(), obtenerBalanceDB(), obtenerVentasVista()
  ]);

  // KPIs
  setTexto('txt-ventas', formatearDinero(balance.totalIngresos));
  setTexto('txt-compras', formatearDinero(balance.totalGastos));
  setTexto('txt-utilidad', formatearDinero(balance.utilidadNeta));
  setTexto('txt-pares', `${tallas.reduce((acc, t) => acc + t.Stock, 0)} pares`);

  // Últimas 5 ventas
  const tabla = el('tabla-ultimas-ventas');
  if (tabla) {
    const ultimas = ventas.slice(0, 5);
    tabla.innerHTML = ultimas.length === 0
      ? '<tr><td colspan="5" class="empty">Aún no hay ventas registradas.</td></tr>'
      : ultimas.map(v => `<tr>
          <td>${formatearFecha(v.Fecha)}</td><td>${esc(v.Cliente)}</td>
          <td>${esc([...new Set(v.lineas.map(l => l.Modelo))].join(', ') || 'S/M')}</td>
          <td class="right">${v.Pares}</td><td class="right"><strong>${formatearDinero(v.Total)}</strong></td></tr>`).join('');
  }

  // Alertas de stock
  const cont = el('lista-stock-bajo');
  if (cont) {
    const nombres = new Map(productos.map(p => [p.IDModelo as number, p.Modelo]));
    const alertas = tallas
      .filter(t => t.Stock <= UMBRAL_STOCK_BAJO)
      .map(t => `${nombres.get(t.IDModelo) ?? `Modelo #${t.IDModelo}`} (Talla ${t.Talla}) - ${t.Stock === 0 ? 'Agotado' : `${t.Stock} pares`}`);
    cont.innerHTML = alertas.length === 0
      ? '<p class="muted">Sin alertas por ahora.</p>'
      : alertas.map(a => `<div class="resumen-linea"><span>${esc(a)}</span></div>`).join('');
  }
}