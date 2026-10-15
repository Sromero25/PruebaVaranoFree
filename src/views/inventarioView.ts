/**
 * inventarioView.ts
 * ----------------------------------------------------------------------------
 * Vista "Inventario".
 *
 * Responsabilidades:
 *  - Mostrar las existencias de calzado por modelo y talla, con una etiqueta
 *    de estado (Disponible / Bajo stock / Agotado).
 *  - Mostrar las existencias de materia prima.
 *
 * Elementos del HTML que utiliza:
 *  #lista-tallas, #tabla-materia
 */

import { db } from '../db.js';
import { UMBRAL_STOCK_BAJO } from '../utils.js';

/** Pinta la tabla de existencias de calzado (modelo, talla, stock, estado). */
async function renderTablaCalzado(): Promise<void> {
  const [tallas, productos] = await Promise.all([
    db.tallas.toArray(),
    db.productos.toArray()
  ]);

  const mapaProductos = new Map(productos.map(p => [p.IDModelo, p.Modelo]));
  const tabla = document.getElementById('lista-tallas');
  if (!tabla) return;

  if (tallas.length === 0) {
    tabla.innerHTML = '<tr><td colspan="4" class="empty">Sin existencias registradas.</td></tr>';
    return;
  }

  tabla.innerHTML = tallas.map(t => {
    const nombreModelo = mapaProductos.get(t.IDModelo) || `Modelo #${t.IDModelo}`;

    let badge = '<span class="badge">Disponible</span>';
    if (t.Stock === 0) {
      badge = '<span class="badge badge-peligro">Agotado</span>';
    } else if (t.Stock <= UMBRAL_STOCK_BAJO) {
      badge = '<span class="badge badge-alerta">Bajo stock</span>';
    }

    return `<tr>
      <td>${nombreModelo}</td>
      <td>${t.Talla}</td>
      <td class="right"><strong>${t.Stock}</strong></td>
      <td>${badge}</td>
    </tr>`;
  }).join('');
}

/** Pinta la tabla de existencias de materia prima. */
async function renderTablaMateriaPrima(): Promise<void> {
  const insumos = await db.materiaPrima.toArray();
  const tabla = document.getElementById('tabla-materia');
  if (!tabla) return;

  if (insumos.length === 0) {
    tabla.innerHTML = '<tr><td colspan="3" class="empty">Sin materiales registrados.</td></tr>';
    return;
  }

  tabla.innerHTML = insumos.map(m => `<tr>
    <td>${m.Nombre}</td>
    <td>${m.Categoria}</td>
    <td class="right"><strong>${m.Stock}</strong></td>
  </tr>`).join('');
}

/** Refresca toda la vista de inventario. */
export async function renderInventarioView(): Promise<void> {
  await Promise.all([renderTablaCalzado(), renderTablaMateriaPrima()]);
}