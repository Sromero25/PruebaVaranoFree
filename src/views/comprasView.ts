/**
 * comprasView.ts
 * ----------------------------------------------------------------------------
 * Vista "Compras".
 *
 * Responsabilidades:
 *  - Poblar los selectores de proveedor y material.
 *  - Registrar compras de materia prima (suma stock del material).
 *  - Dar de alta proveedores y materiales nuevos.
 *  - Pintar el historial de compras.
 *
 * Elementos del HTML que utiliza:
 *  #c-proveedor, #c-item, #c-cantidad, #c-costo, #form-compra,
 *  #form-proveedor (#p-nombre, #p-telefono, #p-direccion),
 *  #form-material (#m-nombre, #m-categoria),
 *  #tabla-compras
 */

import { db } from '../db.js';
import { registrarCompraDB } from '../servicios.js';
import { notificar, formatearDinero, formatearFecha } from '../herramientas.js';

// ----------------------------------------------------------------------------
// Selectores
// ----------------------------------------------------------------------------

/** Llena los selectores de proveedor y material con los datos actuales de la BD. */
export async function actualizarSelectoresCompras(): Promise<void> {
  const [proveedores, insumos] = await Promise.all([
    db.proveedores.toArray(),
    db.materiaPrima.toArray()
  ]);

  const selProv = document.getElementById('c-proveedor') as HTMLSelectElement | null;
  const selItem = document.getElementById('c-item') as HTMLSelectElement | null;

  if (selProv) {
    selProv.innerHTML = '<option value="" disabled selected>Selecciona un proveedor</option>' +
      proveedores.map(p => `<option value="${p.IDProveedor}">${p.Nombre}</option>`).join('');
  }

  if (selItem) {
    selItem.innerHTML = '<option value="" disabled selected>Selecciona un material</option>' +
      insumos.map(i => `<option value="${i.IDItem}">${i.Nombre} (${i.Categoria})</option>`).join('');
  }
}

// ----------------------------------------------------------------------------
// Renderizado
// ----------------------------------------------------------------------------

/** Pinta el historial de compras (más recientes primero). */
export async function renderComprasView(): Promise<void> {
  const [compras, insumos, proveedores] = await Promise.all([
    db.compras.toArray(),
    db.materiaPrima.toArray(),
    db.proveedores.toArray()
  ]);

  const mapaMateriales = new Map(insumos.map(i => [i.IDItem, i.Nombre]));
  const mapaProveedores = new Map(proveedores.map(p => [p.IDProveedor, p.Nombre]));

  const tabla = document.getElementById('tabla-compras');
  if (!tabla) return;

  const comprasDesc = [...compras].sort(
    (a, b) => new Date(b.Fecha).getTime() - new Date(a.Fecha).getTime()
  );

  if (comprasDesc.length === 0) {
    tabla.innerHTML = '<tr><td colspan="5" class="empty">Aún no hay compras registradas.</td></tr>';
    return;
  }

  tabla.innerHTML = comprasDesc.map(c => `<tr>
    <td>${formatearFecha(c.Fecha)}</td>
    <td>${mapaProveedores.get(c.IDProveedor) || 'Proveedor'}</td>
    <td>${mapaMateriales.get(c.IDItem) || 'Insumo'}</td>
    <td class="right">${c.Cantidad}</td>
    <td class="right"><strong>${formatearDinero(c.Costo)}</strong></td>
  </tr>`).join('');
}

// ----------------------------------------------------------------------------
// Formularios y eventos
// ----------------------------------------------------------------------------

/**
 * Registra los eventos de la vista de compras.
 *
 * @param alCambiarDatos  Callback que refresca las demás vistas (inicio,
 *                        resumen, inventario...) tras guardar cambios.
 */
export function inicializarComprasView(alCambiarDatos: () => Promise<void>): void {
  // --- Formulario: nueva compra de material ---
  const formCompra = document.getElementById('form-compra') as HTMLFormElement | null;
  formCompra?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const idProveedor = Number((document.getElementById('c-proveedor') as HTMLSelectElement).value);
    const idItem = Number((document.getElementById('c-item') as HTMLSelectElement).value);
    const cantidad = Number((document.getElementById('c-cantidad') as HTMLInputElement).value);
    const costo = Number((document.getElementById('c-costo') as HTMLInputElement).value);

    await registrarCompraDB(idProveedor, idItem, cantidad, costo);
    notificar('Compra registrada y stock de material sumado');

    formCompra.reset();
    await actualizarSelectoresCompras();
    await alCambiarDatos();
  });

  // --- Formulario: nuevo proveedor ---
  const formProveedor = document.getElementById('form-proveedor') as HTMLFormElement | null;
  formProveedor?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = (document.getElementById('p-nombre') as HTMLInputElement).value.trim();
    const telefono = (document.getElementById('p-telefono') as HTMLInputElement).value.trim();
    const direccion = (document.getElementById('p-direccion') as HTMLInputElement).value.trim();

    await db.proveedores.add({ Nombre: nombre, Telefono: telefono, Direccion: direccion });
    notificar(`Proveedor ${nombre} guardado`);

    formProveedor.reset();
    await actualizarSelectoresCompras();
  });

  // --- Formulario: nuevo material (arranca con stock 0) ---
  const formMaterial = document.getElementById('form-material') as HTMLFormElement | null;
  formMaterial?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = (document.getElementById('m-nombre') as HTMLInputElement).value.trim();
    const categoria = (document.getElementById('m-categoria') as HTMLInputElement).value.trim();

    await db.materiaPrima.add({ Nombre: nombre, Categoria: categoria, Stock: 0 });
    notificar(`Material ${nombre} dado de alta`);

    formMaterial.reset();
    await actualizarSelectoresCompras();
    await alCambiarDatos(); // el nuevo material aparece en Inventario
  });
}