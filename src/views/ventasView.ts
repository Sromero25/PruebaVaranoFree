/**
 * ventasView.ts
 * ----------------------------------------------------------------------------
 * Vista "Ventas".
 *
 * - Una venta se arma como un "carrito" de líneas: se puede agregar un RANGO de
 *   tallas (ej. 18 a 30, 2 pares por talla) o una talla individual, y se pueden
 *   mezclar varios modelos antes de guardar.
 * - Historial de ventas; el administrador puede corregir o anular cada venta.
 */

import { db, type Tallas } from '../db.js';
import { registrarVentaDB, crearClienteDB, corregirVentaDB, anularVentaDB } from '../servicios.js';
import { obtenerVentasVista } from '../consultas.js';
import { esAdmin } from '../auth.js';
import {
  el, esc, notificar, mensajeDeError, formatearDinero, formatearFecha, compactarTallas,
  obtenerOCrearVista, pedirCampos, aInputFecha, desdeInputFecha, type CampoDialogo
} from '../herramientas.js';

interface LineaCarrito {
  IDTalla: number;
  Talla: number;
  Modelo: string;
  Cantidad: number;
  Precio: number;
}

let carrito: LineaCarrito[] = [];
let tallasModelo: Tallas[] = [];
const nombresModelo = new Map<number, string>();
let alCambiar: () => Promise<void> = async () => {};

const enCarrito = (idTalla: number): number =>
  carrito.filter(l => l.IDTalla === idTalla).reduce((acc, l) => acc + l.Cantidad, 0);

// ---------------------------------------------------------------- montaje

export function montarVentasView(alCambiarDatos: () => Promise<void>): void {
  alCambiar = alCambiarDatos;
  const vista = obtenerOCrearVista('ventas');

  vista.innerHTML = `
    <header class="x-cabecera"><h2>Ventas</h2><p>Registra ventas por rango de tallas o por talla individual.</p></header>
    <div class="x-grid">
      <section class="x-card">
        <h3>Nueva venta</h3>
        <form id="form-venta" class="x-form" autocomplete="off">
          <label class="x-campo">Cliente<select id="v-cliente" required></select></label>
          <label class="x-campo">Modelo<select id="v-modelo" required></select></label>
          <label class="x-campo">Precio por par<input id="v-precio" type="number" min="0" step="0.01"></label>
          <p id="v-disponibles" class="x-nota"></p>
          <fieldset class="x-modo">
            <label><input type="radio" name="v-modo" value="rango" checked> Rango de tallas</label>
            <label><input type="radio" name="v-modo" value="unica"> Talla individual</label>
          </fieldset>
          <div id="v-rango" class="x-fila">
            <label class="x-campo">Talla desde<input id="v-desde" type="number" min="1" step="1"></label>
            <label class="x-campo">Talla hasta<input id="v-hasta" type="number" min="1" step="1"></label>
            <label class="x-campo">Pares por talla<input id="v-cant-rango" type="number" min="1" step="1" value="1"></label>
          </div>
          <div id="v-unica" class="x-fila" hidden>
            <label class="x-campo">Talla<select id="v-talla"></select></label>
            <label class="x-campo">Pares<input id="v-cant-unica" type="number" min="1" step="1" value="1"></label>
          </div>
          <button type="button" id="v-agregar" class="x-btn-sec">+ Agregar a la venta</button>
          <div id="v-carrito"></div>
          <button type="submit" class="x-btn">Guardar venta</button>
        </form>
      </section>
      <section class="x-card">
        <h3>Nuevo cliente</h3>
        <form id="form-cliente" class="x-form" autocomplete="off">
          <label class="x-campo">Nombre<input id="n-nombre" required maxlength="60"></label>
          <label class="x-campo">Apellido<input id="n-apellido" maxlength="60"></label>
          <label class="x-campo">Teléfono<input id="n-telefono" type="tel" maxlength="25"></label>
          <button type="submit" class="x-btn">Guardar cliente</button>
        </form>
      </section>
    </div>
    <section class="x-card">
      <h3>Historial de ventas</h3>
      <div class="x-tabla"><table>
        <thead><tr><th>Fecha</th><th>Cliente</th><th>Modelo</th><th>Tallas</th><th class="right">Pares</th><th class="right">Total</th>${esAdmin() ? '<th></th>' : ''}</tr></thead>
        <tbody id="tabla-ventas"></tbody>
      </table></div>
    </section>`;

  // Modo rango / individual
  vista.querySelectorAll<HTMLInputElement>('input[name="v-modo"]').forEach(r =>
    r.addEventListener('change', () => {
      const rango = r.value === 'rango' && r.checked;
      if (r.checked) {
        el('v-rango')!.hidden = !rango;
        el('v-unica')!.hidden = rango;
      }
    })
  );

  el<HTMLSelectElement>('v-modelo')!.addEventListener('change', () => void alElegirModelo());
  el<HTMLSelectElement>('v-talla')!.addEventListener('change', () => {
    el('v-cant-unica')?.focus();
  });
  el('v-agregar')!.addEventListener('click', () => agregarAlCarrito());
  el('v-carrito')!.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-quitar]');
    if (!b) return;
    carrito.splice(Number(b.dataset.quitar), 1);
    pintarCarrito();
  });

  el<HTMLFormElement>('form-venta')!.addEventListener('submit', e => { e.preventDefault(); void guardarVenta(); });
  el<HTMLFormElement>('form-cliente')!.addEventListener('submit', e => { e.preventDefault(); void guardarCliente(); });

  el('tabla-ventas')!.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-accion]');
    if (!b || !esAdmin()) return;
    const id = Number(b.dataset.id);
    void (b.dataset.accion === 'corregir' ? corregirVenta(id) : anularVenta(id));
  });

  pintarCarrito();
}

// ---------------------------------------------------------------- selectores

export async function actualizarSelectoresVentas(): Promise<void> {
  const [clientes, modelos] = await Promise.all([db.clientes.toArray(), db.productos.toArray()]);
  nombresModelo.clear();
  modelos.forEach(m => nombresModelo.set(m.IDModelo as number, m.Modelo));

  const selCliente = el<HTMLSelectElement>('v-cliente');
  const selModelo = el<HTMLSelectElement>('v-modelo');
  if (selCliente) {
    selCliente.innerHTML = '<option value="" disabled selected>Selecciona un cliente</option>' +
      clientes.map(c => `<option value="${c.IDCliente}">${esc(`${c.Nombre} ${c.Apellido}`.trim())}</option>`).join('');
  }
  if (selModelo) {
    selModelo.innerHTML = '<option value="" disabled selected>Selecciona un modelo</option>' +
      modelos.map(m => `<option value="${m.IDModelo}" data-precio="${m.PrecioBase}">Modelo ${esc(m.Modelo)} (base: ${formatearDinero(m.PrecioBase)})</option>`).join('');
  }
  tallasModelo = [];
  await cargarTallasDelModelo();
}

async function cargarTallasDelModelo(): Promise<void> {
  const idModelo = Number(el<HTMLSelectElement>('v-modelo')?.value);
  const selTalla = el<HTMLSelectElement>('v-talla');
  const info = el('v-disponibles');

  tallasModelo = idModelo
    ? (await db.tallas.where('IDModelo').equals(idModelo).toArray()).sort((a, b) => a.Talla - b.Talla)
    : [];

  if (selTalla) {
    selTalla.innerHTML = '<option value="" disabled selected>Selecciona talla</option>' +
      tallasModelo.map(t => `<option value="${t.IDTalla}">Talla ${t.Talla} (${t.Stock} disponibles)</option>`).join('');
  }
  if (info) {
    info.textContent = idModelo
      ? (tallasModelo.length
          ? `Existencias: ${tallasModelo.map(t => `${t.Talla} → ${t.Stock}`).join(' · ')}`
          : 'Este modelo todavía no tiene tallas registradas.')
      : '';
  }
}

async function alElegirModelo(): Promise<void> {
  const sel = el<HTMLSelectElement>('v-modelo')!;
  const precio = sel.options[sel.selectedIndex]?.getAttribute('data-precio');
  if (precio) el<HTMLInputElement>('v-precio')!.value = precio;
  await cargarTallasDelModelo();
}

// ---------------------------------------------------------------- carrito

function agregarAlCarrito(): void {
  const idModelo = Number(el<HTMLSelectElement>('v-modelo')!.value);
  if (!idModelo) return notificar('Elige un modelo.', true);

  const crudoPrecio = el<HTMLInputElement>('v-precio')!.value;
  const precio = Number(crudoPrecio);
  if (crudoPrecio === '' || !Number.isFinite(precio) || precio < 0) return notificar('Captura el precio por par.', true);

  const modo = document.querySelector<HTMLInputElement>('input[name="v-modo"]:checked')?.value ?? 'rango';
  let numeros: number[] = [];
  let cantidad: number;

  if (modo === 'rango') {
    const desde = Number(el<HTMLInputElement>('v-desde')!.value);
    const hasta = Number(el<HTMLInputElement>('v-hasta')!.value);
    cantidad = Number(el<HTMLInputElement>('v-cant-rango')!.value);
    if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde < 1 || hasta < desde) {
      return notificar('Revisa el rango de tallas (desde / hasta).', true);
    }
    if (hasta - desde > 60) return notificar('El rango de tallas es demasiado grande.', true);
    for (let n = desde; n <= hasta; n++) numeros.push(n);
  } else {
    const idTalla = Number(el<HTMLSelectElement>('v-talla')!.value);
    const t = tallasModelo.find(x => x.IDTalla === idTalla);
    if (!t) return notificar('Elige una talla.', true);
    numeros = [t.Talla];
    cantidad = Number(el<HTMLInputElement>('v-cant-unica')!.value);
  }
  if (!Number.isInteger(cantidad) || cantidad < 1) return notificar('Los pares deben ser un número entero mayor a 0.', true);

  const validas: Tallas[] = [];
  const faltantes: number[] = [];
  const sinStock: string[] = [];
  for (const n of numeros) {
    const t = tallasModelo.find(x => x.Talla === n);
    if (!t) { faltantes.push(n); continue; }
    const libres = t.Stock - enCarrito(t.IDTalla as number);
    if (libres < cantidad) sinStock.push(`${n} (hay ${Math.max(libres, 0)})`);
    else validas.push(t);
  }

  if (faltantes.length || sinStock.length) {
    const partes: string[] = [];
    if (faltantes.length) partes.push(`Sin esa talla registrada: ${compactarTallas(faltantes)}`);
    if (sinStock.length) partes.push(`Sin existencia suficiente: ${sinStock.join(', ')}`);
    if (validas.length === 0) return notificar(partes.join(' · '), true);
    if (!confirm(`${partes.join('\n')}\n\n¿Agregar solo las tallas que sí se pueden?`)) return;
  }

  const modelo = nombresModelo.get(idModelo) ?? `#${idModelo}`;
  for (const t of validas) {
    const igual = carrito.find(l => l.IDTalla === t.IDTalla && l.Precio === precio);
    if (igual) igual.Cantidad += cantidad;
    else carrito.push({ IDTalla: t.IDTalla as number, Talla: t.Talla, Modelo: modelo, Cantidad: cantidad, Precio: precio });
  }
  pintarCarrito();
}

function pintarCarrito(): void {
  const cont = el('v-carrito');
  if (!cont) return;
  if (carrito.length === 0) {
    cont.innerHTML = '<p class="muted">Aún no agregas pares a esta venta.</p>';
    return;
  }
  const pares = carrito.reduce((a, l) => a + l.Cantidad, 0);
  const total = carrito.reduce((a, l) => a + l.Cantidad * l.Precio, 0);
  cont.innerHTML = `
    <div class="x-tabla x-carrito"><table>
      <thead><tr><th>Modelo</th><th>Talla</th><th class="right">Pares</th><th class="right">Precio</th><th class="right">Subtotal</th><th></th></tr></thead>
      <tbody>${carrito.map((l, i) => `<tr>
        <td>${esc(l.Modelo)}</td><td>${l.Talla}</td><td class="right">${l.Cantidad}</td>
        <td class="right">${formatearDinero(l.Precio)}</td><td class="right">${formatearDinero(l.Cantidad * l.Precio)}</td>
        <td><button type="button" class="x-btn-mini" data-quitar="${i}" aria-label="Quitar">✕</button></td></tr>`).join('')}</tbody>
    </table></div>
    <p class="x-total"><span>${pares} pares</span><strong>${formatearDinero(total)}</strong></p>`;
}

// ---------------------------------------------------------------- guardar

async function guardarVenta(): Promise<void> {
  const idCliente = Number(el<HTMLSelectElement>('v-cliente')!.value);
  if (!idCliente) return notificar('Elige un cliente.', true);
  try {
    await registrarVentaDB(idCliente, carrito.map(l => ({ IDTalla: l.IDTalla, Cantidad: l.Cantidad, PrecioUnitario: l.Precio })));
    notificar('¡Venta guardada y stock descontado!');
    carrito = [];
    el<HTMLFormElement>('form-venta')!.reset();
    await actualizarSelectoresVentas();
    pintarCarrito();
    await alCambiar();
  } catch (err) {
    notificar(mensajeDeError(err), true);
  }
}

async function guardarCliente(): Promise<void> {
  try {
    const nombre = el<HTMLInputElement>('n-nombre')!.value;
    await crearClienteDB({
      Nombre: nombre,
      Apellido: el<HTMLInputElement>('n-apellido')!.value,
      Telefono: el<HTMLInputElement>('n-telefono')!.value
    });
    notificar(`Cliente ${nombre.trim()} registrado`);
    el<HTMLFormElement>('form-cliente')!.reset();
    await actualizarSelectoresVentas();
  } catch (err) {
    notificar(mensajeDeError(err), true);
  }
}

// ---------------------------------------------------------------- historial

export async function renderVentasView(): Promise<void> {
  const tabla = el('tabla-ventas');
  if (!tabla) return;
  const ventas = await obtenerVentasVista();
  const columnas = esAdmin() ? 7 : 6;

  if (ventas.length === 0) {
    tabla.innerHTML = `<tr><td colspan="${columnas}" class="empty">Aún no hay ventas registradas.</td></tr>`;
    return;
  }

  tabla.innerHTML = ventas.map(v => {
    const modelos = [...new Set(v.lineas.map(l => l.Modelo))].join(', ') || 'S/M';
    const tallas = compactarTallas(v.lineas.map(l => l.Talla).filter((t): t is number => t !== null)) || '-';
    const acciones = esAdmin()
      ? `<td class="x-acciones-fila"><button class="x-btn-mini" data-accion="corregir" data-id="${v.IDVenta}">Corregir</button>
         <button class="x-btn-mini x-peligro" data-accion="anular" data-id="${v.IDVenta}">Anular</button></td>`
      : '';
    return `<tr>
      <td>${formatearFecha(v.Fecha)}</td><td>${esc(v.Cliente)}</td><td>${esc(modelos)}</td><td>${esc(tallas)}</td>
      <td class="right">${v.Pares}</td><td class="right"><strong>${formatearDinero(v.Total)}</strong></td>${acciones}</tr>`;
  }).join('');
}

// ---------------------------------------------------------------- admin: corregir / anular

async function corregirVenta(idVenta: number): Promise<void> {
  const venta = (await obtenerVentasVista()).find(v => v.IDVenta === idVenta);
  if (!venta) return notificar('La venta ya no existe.', true);
  const clientes = await db.clientes.toArray();

  const campos: CampoDialogo[] = [
    { nombre: 'cliente', etiqueta: 'Cliente', tipo: 'select', valor: String(venta.IDCliente),
      opciones: clientes.map(c => ({ valor: String(c.IDCliente), texto: `${c.Nombre} ${c.Apellido}`.trim() })) },
    { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', valor: aInputFecha(venta.Fecha) }
  ];
  for (const l of venta.lineas) {
    campos.push(
      { nombre: `cant_${l.IDDetalle}`, etiqueta: `Modelo ${l.Modelo} · talla ${l.Talla ?? '-'} — pares (0 = quitar)`,
        tipo: 'number', valor: l.Cantidad, min: 0, step: '1' },
      { nombre: `precio_${l.IDDetalle}`, etiqueta: `Precio por par (talla ${l.Talla ?? '-'})`,
        tipo: 'number', valor: l.PrecioUnitario, min: 0, step: '0.01' }
    );
  }

  const r = await pedirCampos(`Corregir venta #${venta.IDVenta}`, campos);
  if (!r) return;
  try {
    await corregirVentaDB(idVenta, {
      IDCliente: Number(r.cliente),
      Fecha: desdeInputFecha(r.fecha ?? ''),
      lineas: venta.lineas.map(l => ({
        IDDetalle: l.IDDetalle,
        Cantidad: Number(r[`cant_${l.IDDetalle}`]),
        PrecioUnitario: Number(r[`precio_${l.IDDetalle}`])
      }))
    });
    notificar('Venta corregida y stock ajustado.');
    await actualizarSelectoresVentas();
    await alCambiar();
  } catch (err) {
    notificar(mensajeDeError(err), true);
  }
}

async function anularVenta(idVenta: number): Promise<void> {
  if (!confirm('¿Anular esta venta? Los pares regresarán al inventario.')) return;
  try {
    await anularVentaDB(idVenta);
    notificar('Venta anulada y stock devuelto.');
    await actualizarSelectoresVentas();
    await alCambiar();
  } catch (err) {
    notificar(mensajeDeError(err), true);
  }
}