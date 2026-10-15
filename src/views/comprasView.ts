/**
 * comprasView.ts
 * ----------------------------------------------------------------------------
 * Vista "Compras".
 *
 * - Todo es de selección: proveedor + uno o varios materiales con su cantidad.
 * - El costo se calcula solo con el precio que tiene cada material en la BD.
 * - Alta de proveedores y materiales: sólo en el panel de administración.
 * - El administrador puede anular compras.
 */

import { db, type InventarioMPrima } from '../db.js';
import { registrarCompraDB, anularCompraDB } from '../servicios.js';
import { obtenerComprasVista } from '../consultas.js';
import { esAdmin } from '../auth.js';
import {
  el, esc, notificar, mensajeDeError, formatearDinero, formatearFecha, obtenerOCrearVista
} from '../herramientas.js';

let carrito: { IDItem: number; Cantidad: number }[] = [];
let materiales: InventarioMPrima[] = [];
let alCambiar: () => Promise<void> = async () => {};

export function montarComprasView(alCambiarDatos: () => Promise<void>): void {
  alCambiar = alCambiarDatos;
  const vista = obtenerOCrearVista('compras');

  vista.innerHTML = `
    <header class="x-cabecera"><h2>Compras</h2><p>Selecciona el proveedor y los materiales; el costo se calcula con los precios registrados.</p></header>
    <section class="x-card">
      <h3>Nueva compra</h3>
      <form id="form-compra" class="x-form" autocomplete="off">
        <label class="x-campo">Proveedor<select id="c-proveedor" required></select></label>
        <div class="x-fila">
          <label class="x-campo">Material<select id="c-item"></select></label>
          <label class="x-campo">Cantidad<input id="c-cantidad" type="number" min="0.01" step="any" value="1"></label>
        </div>
        <button type="button" id="c-agregar" class="x-btn-sec">+ Agregar a la compra</button>
        <div id="c-carrito"></div>
        <button type="submit" class="x-btn">Registrar compra</button>
      </form>
    </section>
    <section class="x-card">
      <h3>Historial de compras</h3>
      <div class="x-tabla"><table>
        <thead><tr><th>Fecha</th><th>Proveedor</th><th>Materiales</th><th class="right">Total</th>${esAdmin() ? '<th></th>' : ''}</tr></thead>
        <tbody id="tabla-compras"></tbody>
      </table></div>
    </section>`;

  el('c-agregar')!.addEventListener('click', () => agregar());
  el('c-carrito')!.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-quitar]');
    if (!b) return;
    carrito.splice(Number(b.dataset.quitar), 1);
    pintarCarrito();
  });
  el<HTMLFormElement>('form-compra')!.addEventListener('submit', e => { e.preventDefault(); void guardar(); });
  el('tabla-compras')!.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-anular]');
    if (b && esAdmin()) void anular(Number(b.dataset.anular));
  });
  pintarCarrito();
}

export async function actualizarSelectoresCompras(): Promise<void> {
  const [proveedores, mats] = await Promise.all([db.proveedores.toArray(), db.materiaPrima.toArray()]);
  materiales = mats;

  const selProv = el<HTMLSelectElement>('c-proveedor');
  const selItem = el<HTMLSelectElement>('c-item');
  if (selProv) {
    selProv.innerHTML = '<option value="" disabled selected>Selecciona un proveedor</option>' +
      proveedores.map(p => `<option value="${p.IDProveedor}">${esc(p.Nombre)}</option>`).join('');
  }
  if (selItem) {
    selItem.innerHTML = '<option value="" disabled selected>Selecciona un material</option>' +
      mats.map(m => `<option value="${m.IDItem}">${esc(m.Nombre)} — ${m.Precio > 0 ? formatearDinero(m.Precio) : 'sin precio'}</option>`).join('');
  }
  pintarCarrito();
}

function agregar(): void {
  const idItem = Number(el<HTMLSelectElement>('c-item')!.value);
  const cantidad = Number(el<HTMLInputElement>('c-cantidad')!.value);
  const m = materiales.find(x => x.IDItem === idItem);
  if (!m) return notificar('Elige un material.', true);
  if (!(m.Precio > 0)) return notificar(`"${m.Nombre}" no tiene precio. Pide al administrador que lo registre.`, true);
  if (!Number.isFinite(cantidad) || cantidad <= 0) return notificar('Captura una cantidad mayor a 0.', true);

  const existente = carrito.find(l => l.IDItem === idItem);
  if (existente) existente.Cantidad += cantidad;
  else carrito.push({ IDItem: idItem, Cantidad: cantidad });
  pintarCarrito();
}

function pintarCarrito(): void {
  const cont = el('c-carrito');
  if (!cont) return;
  // Descartar líneas de materiales que ya no existan
  carrito = carrito.filter(l => materiales.some(m => m.IDItem === l.IDItem));
  if (carrito.length === 0) {
    cont.innerHTML = '<p class="muted">Aún no agregas materiales a esta compra.</p>';
    return;
  }
  let total = 0;
  const filas = carrito.map((l, i) => {
    const m = materiales.find(x => x.IDItem === l.IDItem) as InventarioMPrima;
    const subtotal = l.Cantidad * m.Precio;
    total += subtotal;
    return `<tr><td>${esc(m.Nombre)}</td><td class="right">${l.Cantidad}</td><td class="right">${formatearDinero(m.Precio)}</td>
      <td class="right">${formatearDinero(subtotal)}</td>
      <td><button type="button" class="x-btn-mini" data-quitar="${i}" aria-label="Quitar">✕</button></td></tr>`;
  }).join('');
  cont.innerHTML = `
    <div class="x-tabla x-carrito"><table>
      <thead><tr><th>Material</th><th class="right">Cant.</th><th class="right">Precio</th><th class="right">Subtotal</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div>
    <p class="x-total"><span>Total de la compra</span><strong>${formatearDinero(total)}</strong></p>`;
}

async function guardar(): Promise<void> {
  const idProveedor = Number(el<HTMLSelectElement>('c-proveedor')!.value);
  if (!idProveedor) return notificar('Elige un proveedor.', true);
  try {
    await registrarCompraDB(idProveedor, carrito);
    notificar('Compra registrada y stock de material sumado');
    carrito = [];
    el<HTMLFormElement>('form-compra')!.reset();
    await actualizarSelectoresCompras();
    await alCambiar();
  } catch (err) {
    notificar(mensajeDeError(err), true);
  }
}

export async function renderComprasView(): Promise<void> {
  const tabla = el('tabla-compras');
  if (!tabla) return;
  const compras = await obtenerComprasVista();
  const columnas = esAdmin() ? 5 : 4;

  if (compras.length === 0) {
    tabla.innerHTML = `<tr><td colspan="${columnas}" class="empty">Aún no hay compras registradas.</td></tr>`;
    return;
  }
  tabla.innerHTML = compras.map(c => `<tr>
    <td>${formatearFecha(c.Fecha)}</td><td>${esc(c.Proveedor)}</td>
    <td>${esc(c.lineas.map(l => `${l.Material} ×${l.Cantidad}`).join(', ') || '-')}</td>
    <td class="right"><strong>${formatearDinero(c.Total)}</strong></td>
    ${esAdmin() ? `<td class="x-acciones-fila"><button class="x-btn-mini x-peligro" data-anular="${c.IDCompra}">Anular</button></td>` : ''}
  </tr>`).join('');
}

async function anular(idCompra: number): Promise<void> {
  if (!confirm('¿Anular esta compra? Se descontará el material que había sumado.')) return;
  try {
    await anularCompraDB(idCompra);
    notificar('Compra anulada.');
    await actualizarSelectoresCompras();
    await alCambiar();
  } catch (err) {
    notificar(mensajeDeError(err), true);
  }
}