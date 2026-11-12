/**
 * index.ts
 * ----------------------------------------------------------------------------
 * Punto de entrada. Flujo:
 *  1. Abrir IndexedDB (y migrar datos viejos si existen).
 *  2. Datos iniciales si la base está vacía.
 *  3. Sesión cacheada o pantalla de login central.
 *  4. Montar vistas según el rol, arrancar el motor de sincronización.
 */

import './extras.css';
import { inicializarBaseLocal } from './db.js';
import { cargarDatosIniciales } from './seed.js';
import { esAdmin, restaurarSesion } from './auth.js';
import { notificar } from './herramientas.js';
import { inicializarNavegacion } from './navegacion.js';
import { aplicarPermisosUI } from './permisos.js';

import { mostrarLogin, montarBarraSesion } from './views/loginView.js';
import { renderInicioView } from './views/inicioView.js';
import { montarVentasView, actualizarSelectoresVentas, renderVentasView } from './views/ventasView.js';
import { montarComprasView, actualizarSelectoresCompras, renderComprasView } from './views/comprasView.js';
import { montarInventarioView, renderInventarioView } from './views/inventarioView.js';
import { renderResumenView, inicializarResumenView } from './views/resumenView.js';
import { montarAdminView, renderAdminView } from './views/adminView.js';
import { iniciarMotorSync } from './sync/engine.js';
import { montarEstadoSync } from './sync/estadoView.js';

/** Vuelve a pintar tablas y métricas de todas las vistas. */
async function refrescarTodo(): Promise<void> {
  const tareas: Promise<void>[] = [
    renderInicioView(),
    renderVentasView(),
    renderInventarioView()
  ];
  // Compras, resumen y administración solo existen para administradores.
  if (esAdmin()) {
    tareas.push(renderComprasView(), renderResumenView(), renderAdminView());
  }
  await Promise.all(tareas);
}

/** Refresca y recarga los selectores (por si cambió un proveedor, material o modelo). */
async function refrescarConSelectores(): Promise<void> {
  const tareas: Promise<void>[] = [actualizarSelectoresVentas()];
  if (esAdmin()) tareas.push(actualizarSelectoresCompras());
  await Promise.all(tareas);
  await refrescarTodo();
}

async function iniciar(): Promise<void> {
  const app = document.getElementById('app');
  app?.style.setProperty('display', 'none'); // oculta la app hasta iniciar sesión

  // El service worker permite abrir la app sin internet (solo en producción).
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(error => {
        console.warn('No se pudo registrar el service worker:', error);
      });
    });
  }

  try {
    await inicializarBaseLocal();
    // Los datos de ejemplo son solo para demos: nunca se cargan por defecto.
    if (import.meta.env.VITE_SEED_DEMO === 'true') await cargarDatosIniciales();
    if (!(await restaurarSesion())) await mostrarLogin();

    montarVentasView(refrescarConSelectores);
    if (esAdmin()) montarComprasView(refrescarConSelectores);
    montarInventarioView(refrescarConSelectores);
    montarAdminView(refrescarConSelectores); // sólo existe para administradores
    aplicarPermisosUI();
    montarBarraSesion();
    montarEstadoSync();
    inicializarNavegacion();
    if (esAdmin()) inicializarResumenView();

    app?.style.removeProperty('display');
    await refrescarConSelectores();
    iniciarMotorSync(refrescarConSelectores);

    // Otra pestaña del mismo equipo puede haber escrito en la misma base local.
    window.addEventListener('focus', () => { void refrescarConSelectores(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refrescarConSelectores();
    });
  } catch (error) {
    console.error('Error al inicializar la app:', error);
    app?.style.removeProperty('display');
    notificar('Ocurrió un error al cargar los datos del taller', true);
  }
}

void iniciar();
