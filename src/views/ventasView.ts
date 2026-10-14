/**
 * ventasView.ts
 * ----------------------------------------------------------------------------
 * Vista "Ventas".
 *
 * Responsabilidades:
 *  - Poblar los selectores del formulario de venta (cliente, modelo, talla).
 *  - Sugerir el precio base y mostrar el stock al elegir modelo / talla.
 *  - Registrar ventas y clientes nuevos.
 *  - Pintar el historial de ventas.
 *
 * Elementos del HTML que utiliza:
 *  #v-cliente, #v-modelo, #v-talla, #v-cantidad, #v-precio, #v-disponibles,
 *  #form-venta, #form-cliente (#n-nombre, #n-apellido, #n-telefono),
 *  #tabla-ventas
 */

import { db } from '../db.js';
import { registrarVentaDB } from '../servicios.js';
import { notificar, formatearDinero, formatearFecha } from '../Utils.js';

// ----------------------------------------------------------------------------
// Selectores
// ----------------------------------------------------------------------------

/** Llena los selectores de cliente y modelo con los datos actuales de la BD. */
export async function actualizarSelectoresVentas(): Promise<void> {
  const [clientes, modelos] = await Promise.all([
    db.clientes.toArray(),
    db.productos.toArray()
  ]);

  const selCliente = document.getElementById('v-cliente') as HTMLSelectElement | null;
  const selModelo = document.getElementById('v-modelo') as HTMLSelectElement | null;

  if (selCliente) {
    selCliente.innerHTML = '<option value="" disabled selected>Selecciona un cliente</option>' +
      clientes.map(c => `<option value="${c.IDCliente}">${c.Nombre} ${c.Apellido}</option>`).join('');
  }

  if (selModelo) {
    selModelo.innerHTML = '<option value="" disabled selected>Selecciona un modelo</option>' +
      modelos.map(m => `<option value="${m.IDModelo}" data-precio="${m.PrecioBase}">Modelo ${m.Modelo} (Base: $${m.PrecioBase})</option>`).join('');
  }
}

/** Deja el selector de tallas vacío y limpia el texto de stock disponible. */
function limpiarTallas(): void {
  const selTalla = document.getElementById('v-talla') as HTMLSelectElement | null;
  const txtDisponibles = document.getElementById('v-disponibles');

  if (selTalla) {
    selTalla.innerHTML = '<option value="" disabled selected>Selecciona talla</option>';
  }
  if (txtDisponibles) txtDisponibles.textContent = '';
}

/**
 * Registra los eventos `change` de modelo y talla:
 *  - Al elegir un modelo: sugiere su precio base y carga sus tallas.
 *  - Al elegir una talla: muestra el stock disponible.
 */
function inicializarCambioModelo(): void {
  const selModelo = document.getElementById('v-modelo') as HTMLSelectElement | null;
  const selTalla = document.getElementById('v-talla') as HTMLSelectElement | null;
  const inputPrecio = document.getElementById('v-precio') as HTMLInputElement | null;
  const txtDisponibles = document.getElementById('v-disponibles');

  if (!selModelo || !selTalla) return;

  selModelo.addEventListener('change', async () => {
    const idModelo = Number(selModelo.value);
    const optionSel = selModelo.options[selModelo.selectedIndex];

    // Sugerir el precio base del modelo
    if (inputPrecio && optionSel) {
      inputPrecio.value = optionSel.getAttribute('data-precio') || '0';
    }

    // Cargar las tallas de ese modelo
    const tallas = await db.tallas.where('IDModelo').equals(idModelo).toArray();
    selTalla.innerHTML = '<option value="" disabled selected>Selecciona talla</option>' +
      tallas.map(t => `<option value="${t.IDTalla}" data-stock="${t.Stock}">Talla ${t.Talla} (${t.Stock} disponibles)</option>`).join('');

    if (txtDisponibles) txtDisponibles.textContent = '';
  });

  selTalla.addEventListener('change', () => {
    const optTalla = selTalla.options[selTalla.selectedIndex];
    const stock = optTalla?.getAttribute('data-stock') || '0';
    if (txtDisponibles) {
      txtDisponibles.textContent = `Stock actual: ${stock} pares`;
    }
  });
}

// ----------------------------------------------------------------------------
// Renderizado
// ----------------------------------------------------------------------------

/** Pinta el historial completo de ventas (más recientes primero). */
export async function renderVentasView(): Promise<void> {
  const [ventas, tallas, productos, clientes] = await Promise.all([
    db.ventas.toArray(),
    db.tallas.toArray(),
    db.productos.toArray(),
    db.clientes.toArray()
  ]);

  // Mapas auxiliares para mostrar nombres en lugar de IDs
  const mapaProductos = new Map(productos.map(p => [p.IDModelo, p.Modelo]));
  const mapaTallas = new Map(tallas.map(t => [t.IDTalla, { talla: t.Talla, idModelo: t.IDModelo }]));
  const mapaClientes = new Map(clientes.map(c => [c.IDCliente, `${c.Nombre} ${c.Apellido}`]));

  const tabla = document.getElementById('tabla-ventas');
  if (!tabla) return;

  const ventasDesc = [...ventas].sort(
    (a, b) => new Date(b.Fecha).getTime() - new Date(a.Fecha).getTime()
  );

  if (ventasDesc.length === 0) {
    tabla.innerHTML = '<tr><td colspan="7" class="empty">Aún no hay ventas registradas.</td></tr>';
    return;
  }

  tabla.innerHTML = ventasDesc.map(v => {
    const infoTalla = mapaTallas.get(v.IDTalla);
    const modelo = infoTalla ? (mapaProductos.get(infoTalla.idModelo) || 'S/M') : 'S/M';
    const numTalla = infoTalla ? infoTalla.talla : '-';
    const cliente = mapaClientes.get(v.IDCliente) || 'Venta directa';

    return `<tr>
      <td>${formatearFecha(v.Fecha)}</td>
      <td>${cliente}</td>
      <td>${modelo}</td>
      <td>${numTalla}</td>
      <td class="right">${v.Cantidad}</td>
      <td class="right">${formatearDinero(v.PrecioUnitario)}</td>
      <td class="right"><strong>${formatearDinero(v.Cantidad * v.PrecioUnitario)}</strong></td>
    </tr>`;
  }).join('');
}

// ----------------------------------------------------------------------------
// Formularios y eventos
// ----------------------------------------------------------------------------

/**
 * Registra los eventos de la vista de ventas.
 *
 * @param alCambiarDatos  Callback que refresca las demás vistas (inicio,
 *                        resumen, inventario...) tras guardar una venta.
 */
export function inicializarVentasView(alCambiarDatos: () => Promise<void>): void {
  inicializarCambioModelo();

  // --- Formulario: nueva venta ---
  const formVenta = document.getElementById('form-venta') as HTMLFormElement | null;
  formVenta?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const idCliente = Number((document.getElementById('v-cliente') as HTMLSelectElement).value);
    const idTalla = Number((document.getElementById('v-talla') as HTMLSelectElement).value);
    const cantidad = Number((document.getElementById('v-cantidad') as HTMLInputElement).value);
    const precioUnitario = Number((document.getElementById('v-precio') as HTMLInputElement).value);

    // Validación previa de stock
    const variante = await db.tallas.get(idTalla);
    if (!variante || variante.Stock < cantidad) {
      notificar(`Stock insuficiente. Quedan solo ${variante ? variante.Stock : 0} pares.`, true);
      return;
    }

    await registrarVentaDB(idCliente, idTalla, cantidad, precioUnitario);
    notificar('¡Venta guardada y stock descontado con éxito!');

    formVenta.reset();
    limpiarTallas(); // evita mostrar tallas con stock desactualizado
    await actualizarSelectoresVentas();
    await alCambiarDatos();
  });

  // --- Formulario: nuevo cliente ---
  const formCliente = document.getElementById('form-cliente') as HTMLFormElement | null;
  formCliente?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = (document.getElementById('n-nombre') as HTMLInputElement).value.trim();
    const apellido = (document.getElementById('n-apellido') as HTMLInputElement).value.trim();
    const telefono = (document.getElementById('n-telefono') as HTMLInputElement).value.trim();

    await db.clientes.add({ Nombre: nombre, Apellido: apellido, Telefono: telefono });
    notificar(`Cliente ${nombre} ${apellido} registrado`);

    formCliente.reset();
    await actualizarSelectoresVentas();
  });
}