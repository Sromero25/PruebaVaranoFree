/**
 * inicioView.ts
 * ----------------------------------------------------------------------------
 * Vista "Inicio" (panel principal).
 *
 * Responsabilidades:
 *  - Mostrar los KPIs: ventas, compras, utilidad y pares en bodega.
 *  - Mostrar las últimas 5 ventas.
 *  - Mostrar las alertas de stock bajo / agotado.
 *
 * Elementos del HTML que utiliza:
 *  #txt-ventas, #txt-compras, #txt-utilidad, #txt-pares,
 *  #tabla-ultimas-ventas, #lista-stock-bajo
 */

import { db } from '../db.js';
import { obtenerBalanceDB } from '../servicios.js';
import { formatearDinero, formatearFecha, UMBRAL_STOCK_BAJO } from '../herramientas.js';

/** Asigna texto a un elemento por id (si existe). */
function setTexto(id: string, texto: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = texto;
}

/** Pinta los 4 indicadores principales. */
async function renderKPIs(): Promise<void> {
  const [tallas, balance] = await Promise.all([
    db.tallas.toArray(),
    obtenerBalanceDB()
  ]);

  const totalParesBodega = tallas.reduce((acc, t) => acc + t.Stock, 0);

  setTexto('txt-ventas', formatearDinero(balance.totalIngresos));
  setTexto('txt-compras', formatearDinero(balance.totalGastos));
  setTexto('txt-utilidad', formatearDinero(balance.utilidadNeta));
  setTexto('txt-pares', `${totalParesBodega} pares`);
}

/** Pinta las 5 ventas más recientes. */
async function renderUltimasVentas(): Promise<void> {
  const [ventas, tallas, productos, clientes] = await Promise.all([
    db.ventas.toArray(),
    db.tallas.toArray(),
    db.productos.toArray(),
    db.clientes.toArray()
  ]);

  const mapaProductos = new Map(productos.map(p => [p.IDModelo, p.Modelo]));
  const mapaTallas = new Map(tallas.map(t => [t.IDTalla, { talla: t.Talla, idModelo: t.IDModelo }]));
  const mapaClientes = new Map(clientes.map(c => [c.IDCliente, `${c.Nombre} ${c.Apellido}`]));

  const tabla = document.getElementById('tabla-ultimas-ventas');
  if (!tabla) return;

  const ultimas5 = [...ventas]
    .sort((a, b) => new Date(b.Fecha).getTime() - new Date(a.Fecha).getTime())
    .slice(0, 5);

  if (ultimas5.length === 0) {
    tabla.innerHTML = '<tr><td colspan="5" class="empty">Aún no hay ventas registradas.</td></tr>';
    return;
  }

  tabla.innerHTML = ultimas5.map(v => {
    const infoTalla = mapaTallas.get(v.IDTalla);
    const modelo = infoTalla ? (mapaProductos.get(infoTalla.idModelo) || 'S/M') : 'S/M';
    const cliente = mapaClientes.get(v.IDCliente) || 'General';

    return `<tr>
      <td>${formatearFecha(v.Fecha)}</td>
      <td>${cliente}</td>
      <td>${modelo}</td>
      <td class="right">${v.Cantidad}</td>
      <td class="right"><strong>${formatearDinero(v.Cantidad * v.PrecioUnitario)}</strong></td>
    </tr>`;
  }).join('');
}

/** Pinta la lista de tallas agotadas o con stock bajo. */
async function renderAlertasStock(): Promise<void> {
  const [tallas, productos] = await Promise.all([
    db.tallas.toArray(),
    db.productos.toArray()
  ]);

  const mapaProductos = new Map(productos.map(p => [p.IDModelo, p.Modelo]));
  const contenedor = document.getElementById('lista-stock-bajo');
  if (!contenedor) return;

  const alertas: string[] = [];
  for (const t of tallas) {
    const nombreModelo = mapaProductos.get(t.IDModelo) || `Modelo #${t.IDModelo}`;
    if (t.Stock === 0) {
      alertas.push(`${nombreModelo} (Talla ${t.Talla}) - Agotado`);
    } else if (t.Stock <= UMBRAL_STOCK_BAJO) {
      alertas.push(`${nombreModelo} (Talla ${t.Talla}) - ${t.Stock} pares`);
    }
  }

  contenedor.innerHTML = alertas.length === 0
    ? '<p class="muted">Sin alertas por ahora.</p>'
    : alertas.map(item => `<div class="resumen-linea"><span>${item}</span></div>`).join('');
}

/** Refresca toda la vista de inicio. */
export async function renderInicioView(): Promise<void> {
  await Promise.all([renderKPIs(), renderUltimasVentas(), renderAlertasStock()]);
}