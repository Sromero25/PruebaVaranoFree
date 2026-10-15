/**
 * inventarioView.ts
 * ----------------------------------------------------------------------------
 * Vista "Inventario" con dos pestañas:
 *  - Calzado: alta de modelo + tallas + cantidad, y tabla de existencias.
 *  - Materia prima: existencias y precios (se administran en el panel admin).
 * El administrador puede corregir la existencia o eliminar tallas.
 */

import { db } from '../db.js';
import { agregarInventarioCalzadoDB, ajustarStockTallaDB, eliminarTallaDB } from '../servicios.js';
import { esAdmin } from '../auth.js';
import {
  el, esc, notificar, mensajeDeError, formatearDinero, obtenerOCrearVista, pedirCampos, UMBRAL_STOCK_BAJO
} from '../herramientas.js';

let alCambiar: () => Promise<void> = async () => {};

export function montarInventarioView(alCambiarDatos: () => Promise<void>): void {
  alCambiar = alCambiarDatos;
  const vista = obtenerOCrearVista('inventario');
  const admin = esAdmin();

  vista.innerHTML = `
    <header class="x-cabecera"><h2>Inventario</h2><p>Existencias de calzado y de materia prima.</p></header>
    <div class="x-tabs" role="tablist">
      <button type="button" class="x-tab" role="tab" data-tab="calzado" aria-selected="true">Calzado</button>
      <button type="button" class="x-tab" role="tab" data-tab="materia" aria-selected="false">Materia prima</button>
    </div>

    <div id="inv-calzado">
      <section class="x-card">
        <h3>Agregar calzado al inventario</h3>
        <form id="form-calzado" class="x-form" autocomplete="off">
          <div class="x-fila">
            <label class="x-campo">Modelo<input id="i-modelo" list="i-modelos" required maxlength="40"></label>
            <label class="x-campo">Precio base (solo modelo nuevo)<input id="i-precio" type="number" min="0" step="0.01"></label>
          </div>
          <datalist id="i-modelos"></datalist>
          <div class="x-fila">
            <label class="x-campo">Talla desde<input id="i-desde" type="number" min="1" step="1" required></label>
            <label class="x-campo">Talla hasta<input id="i-hasta" type="number" min="1" step="1" required></label>
            <label class="x-campo">Pares por talla<input id="i-cantidad" type="number" min="1" step="1" required></label>
          </div>
          <p class="x-nota">Para una sola talla, pon el mismo número en "desde" y "hasta". Si la talla ya existe, se suman los pares.</p>
          <button type="submit" class="x-btn">Agregar al inventario</button>
        </form>
      </section>
      <section class="x-card">
        <h3>Existencias de calzado</h3>
        <div class="x-tabla"><table>
          <thead><tr><th>Modelo</th><th>Talla</th><th class="right">Stock</th><th>Estado</th>${admin ? '<th></th>' : ''}</tr></thead>
          <tbody id="lista-tallas"></tbody>
        </table></div>
      </section>
    </div>

    <div id="inv-materia" hidden>
      <section class="x-card">
        <h3>Existencias de materia prima</h3>
        <div class="x-tabla"><table>
          <thead><tr><th>Material</th><th>Categoría</th><th class="right">Precio</th><th class="right">Existencia</th></tr></thead>
          <tbody id="tabla-materia"></tbody>
        </table></div>
        <p class="x-nota">Los materiales y sus precios los administra el administrador.</p>
      </section>
    </div>`;

  vista.querySelectorAll<HTMLButtonElement>('.x-tab').forEach(tab =>
    tab.addEventListener('click', () => {
      vista.querySelectorAll<HTMLButtonElement>('.x-tab').forEach(t =>
        t.setAttribute('aria-selected', String(t === tab)));
      el('inv-calzado')!.hidden = tab.dataset.tab !== 'calzado';
      el('inv-materia')!.hidden = tab.dataset.tab !== 'materia';
    })
  );

  el<HTMLFormElement>('form-calzado')!.addEventListener('submit', e => { e.preventDefault(); void guardarCalzado(); });

  el('lista-tallas')!.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-accion]');
    if (!b || !esAdmin()) return;
    const id = Number(b.dataset.id);
    void (b.dataset.accion === 'stock' ? corregirStock(id, b.dataset.nombre ?? '', Number(b.dataset.stock)) : borrarTalla(id));
  });
}

async function guardarCalzado(): Promise<void> {
  const precio = el<HTMLInputElement>('i-precio')!.value;
  try {
    const r = await agregarInventarioCalzadoDB({
      modelo: el<HTMLInputElement>('i-modelo')!.value,
      precioBase: precio === '' ? undefined : Number(precio),
      tallaDesde: Number(el<HTMLInputElement>('i-desde')!.value),
      tallaHasta: Number(el<HTMLInputElement>('i-hasta')!.value),
      cantidad: Number(el<HTMLInputElement>('i-cantidad')!.value)
    });
    notificar(`${r.modeloNuevo ? 'Modelo nuevo' : 'Modelo'} ${r.modelo}: ${r.tallasNuevas} tallas nuevas, ${r.tallasActualizadas} actualizadas.`);
    el<HTMLFormElement>('form-calzado')!.reset();
    await alCambiar();
  } catch (err) {
    notificar(mensajeDeError(err), true);
  }
}

async function corregirStock(idTalla: number, nombre: string, actual: number): Promise<void> {
  const r = await pedirCampos('Corregir existencia', [
    { nombre: 'stock', etiqueta: `${nombre} — existencia real`, tipo: 'number', valor: actual, min: 0, step: '1' }
  ]);
  if (!r) return;
  try {
    await ajustarStockTallaDB(idTalla, Number(r.stock));
    notificar('Existencia corregida.');
    await alCambiar();
  } catch (err) {
    notificar(mensajeDeError(err), true);
  }
}

async function borrarTalla(idTalla: number): Promise<void> {
  if (!confirm('¿Eliminar esta talla del inventario?')) return;
  try {
    await eliminarTallaDB(idTalla);
    notificar('Talla eliminada.');
    await alCambiar();
  } catch (err) {
    notificar(mensajeDeError(err), true);
  }
}

export async function renderInventarioView(): Promise<void> {
  const [tallas, productos, insumos] = await Promise.all([
    db.tallas.toArray(), db.productos.toArray(), db.materiaPrima.toArray()
  ]);
  const admin = esAdmin();
  const nombres = new Map(productos.map(p => [p.IDModelo as number, p.Modelo]));

  const lista = el('i-modelos');
  if (lista) lista.innerHTML = productos.map(p => `<option value="${esc(p.Modelo)}"></option>`).join('');

  const tabla = el('lista-tallas');
  if (tabla) {
    if (tallas.length === 0) {
      tabla.innerHTML = `<tr><td colspan="${admin ? 5 : 4}" class="empty">Sin existencias registradas.</td></tr>`;
    } else {
      const orden = [...tallas].sort((a, b) =>
        (nombres.get(a.IDModelo) ?? '').localeCompare(nombres.get(b.IDModelo) ?? '', 'es', { numeric: true }) || a.Talla - b.Talla);
      tabla.innerHTML = orden.map(t => {
        const nombre = nombres.get(t.IDModelo) ?? `Modelo #${t.IDModelo}`;
        let badge = '<span class="badge">Disponible</span>';
        if (t.Stock === 0) badge = '<span class="badge badge-peligro">Agotado</span>';
        else if (t.Stock <= UMBRAL_STOCK_BAJO) badge = '<span class="badge badge-alerta">Bajo stock</span>';
        const acciones = admin
          ? `<td class="x-acciones-fila"><button class="x-btn-mini" data-accion="stock" data-id="${t.IDTalla}" data-stock="${t.Stock}" data-nombre="${esc(`${nombre} talla ${t.Talla}`)}">Corregir</button>
             <button class="x-btn-mini x-peligro" data-accion="borrar" data-id="${t.IDTalla}">Eliminar</button></td>`
          : '';
        return `<tr><td>${esc(nombre)}</td><td>${t.Talla}</td><td class="right"><strong>${t.Stock}</strong></td><td>${badge}</td>${acciones}</tr>`;
      }).join('');
    }
  }

  const materia = el('tabla-materia');
  if (materia) {
    materia.innerHTML = insumos.length === 0
      ? '<tr><td colspan="4" class="empty">Sin materiales registrados.</td></tr>'
      : insumos.map(m => `<tr><td>${esc(m.Nombre)}</td><td>${esc(m.Categoria)}</td>
          <td class="right">${m.Precio > 0 ? formatearDinero(m.Precio) : '<span class="badge badge-alerta">Sin precio</span>'}</td>
          <td class="right"><strong>${m.Stock}</strong></td></tr>`).join('');
  }
}