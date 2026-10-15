/**
 * main.ts
 * ----------------------------------------------------------------------------
 * Punto de entrada de la aplicación.
 *
 * Orquesta el arranque: navegación, datos iniciales, selectores, eventos de
 * cada vista y primer pintado de tablas y métricas.
 *
 * Estructura del proyecto:
 *  src/
 *   ├─ main.ts              (este archivo)
 *   ├─ utils.ts             (toast, formato de dinero y fechas, constantes)
 *   ├─ navegacion.ts        (cambio de vistas y menú móvil)
 *   └─ views/
 *       ├─ inicioView.ts     (KPIs, últimas ventas, alertas de stock)
 *       ├─ ventasView.ts     (formulario de venta/cliente, historial)
 *       ├─ comprasView.ts    (formularios de compra/proveedor/material, historial)
 *       ├─ inventarioView.ts (existencias de calzado y materia prima)
 *       └─ resumenView.ts    (resumen del mes e impresión)
 */

import { cargarDatosIniciales } from './seed.js';
import { notificar } from './herramientas.js';
import { inicializarNavegacion } from './navegacion.js';

import { renderInicioView } from './views/inicioView.js';
import { actualizarSelectoresVentas, renderVentasView, inicializarVentasView } from './views/ventasView.js';
import { actualizarSelectoresCompras, renderComprasView, inicializarComprasView } from './views/comprasView.js';
import { renderInventarioView } from './views/inventarioView.js';
import { renderResumenView, inicializarResumenView } from './views/resumenView.js';

/**
 * Vuelve a pintar las tablas y métricas de todas las vistas.
 * Se pasa como callback a las vistas con formularios para que, al guardar
 * algo, el resto de la app se mantenga sincronizada.
 */
async function refrescarTodo(): Promise<void> {
  await Promise.all([
    renderInicioView(),
    renderVentasView(),
    renderComprasView(),
    renderInventarioView(),
    renderResumenView()
  ]);
}

async function iniciar(): Promise<void> {
  try {
    inicializarNavegacion();
    await cargarDatosIniciales();

    // Selectores de los formularios
    await Promise.all([actualizarSelectoresVentas(), actualizarSelectoresCompras()]);

    // Eventos de cada vista
    inicializarVentasView(refrescarTodo);
    inicializarComprasView(refrescarTodo);
    inicializarResumenView();

    // Primer pintado
    await refrescarTodo();
  } catch (error) {
    console.error('Error al inicializar la app:', error);
    notificar('Ocurrió un error al cargar los datos del taller', true);
  }
}

iniciar();