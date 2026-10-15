/**
 * main.ts  (renómbralo a index.ts si tu index.html carga /src/index.ts)
 * ----------------------------------------------------------------------------
 * Punto de entrada. Flujo:
 *  1. Datos iniciales  2. Sesión guardada o pantalla de login
 *  3. Montar vistas según el rol  4. Primer pintado
 *
 * src/
 *  ├─ db.ts            base de datos y migración
 *  ├─ seguridad.ts     hash de contraseñas y tokens
 *  ├─ auth.ts          usuarios, sesión y permisos
 *  ├─ servicios.ts     operaciones que modifican datos (validadas)
 *  ├─ consultas.ts     lecturas con nombres resueltos
 *  ├─ herramientas.ts  toast, formato, escape de HTML, diálogos
 *  ├─ navegacion.ts    cambio de vistas y menú móvil
 *  ├─ extras.css       estilos de las vistas nuevas
 *  └─ views/           inicio, ventas, compras, inventario, resumen, admin, login
 */

import './extras.css';
import { cargarDatosIniciales } from './seed.js';
import { restaurarSesion } from './auth.js';
import { notificar } from './herramientas.js';
import { inicializarNavegacion } from './navegacion.js';

import { mostrarLogin, montarBarraSesion } from './views/loginView.js';
import { renderInicioView } from './views/inicioView.js';
import { montarVentasView, actualizarSelectoresVentas, renderVentasView } from './views/ventasView.js';
import { montarComprasView, actualizarSelectoresCompras, renderComprasView } from './views/comprasView.js';
import { montarInventarioView, renderInventarioView } from './views/inventarioView.js';
import { renderResumenView, inicializarResumenView } from './views/resumenView.js';
import { montarAdminView, renderAdminView } from './views/adminVIew.js';

/** Vuelve a pintar tablas y métricas de todas las vistas. */
async function refrescarTodo(): Promise<void> {
  await Promise.all([
    renderInicioView(),
    renderVentasView(),
    renderComprasView(),
    renderInventarioView(),
    renderResumenView(),
    renderAdminView()
  ]);
}

/** Refresca y recarga los selectores (por si cambió un proveedor, material o modelo). */
async function refrescarConSelectores(): Promise<void> {
  await Promise.all([actualizarSelectoresVentas(), actualizarSelectoresCompras()]);
  await refrescarTodo();
}

async function iniciar(): Promise<void> {
  const app = document.getElementById('app');
  app?.style.setProperty('display', 'none'); // oculta la app hasta iniciar sesión

  try {
    await cargarDatosIniciales();
    if (!(await restaurarSesion())) await mostrarLogin();

    montarVentasView(refrescarConSelectores);
    montarComprasView(refrescarConSelectores);
    montarInventarioView(refrescarConSelectores);
    montarAdminView(refrescarConSelectores); // sólo existe para administradores
    montarBarraSesion();
    inicializarNavegacion();
    inicializarResumenView();

    app?.style.removeProperty('display');
    await refrescarConSelectores();
  } catch (error) {
    console.error('Error al inicializar la app:', error);
    app?.style.removeProperty('display');
    notificar('Ocurrió un error al cargar los datos del taller', true);
  }
}

void iniciar();