/**
 * permisos.ts
 * ----------------------------------------------------------------------------
 * Ajusta la interfaz al rol de la sesión.
 *
 * Administrador: ve Inicio, Ventas, Compras, Inventario, Resumen y Administración.
 * Usuario normal: ve Inicio, Ventas e Inventario. No ve compras, costos,
 * utilidad, resumen financiero ni administración.
 */

import { esAdmin } from './auth.js';

export function aplicarPermisosUI(): void {
  const admin = esAdmin();
  document.body.dataset.rol = admin ? 'admin' : 'normal';

  if (admin) return;

  // Todo lo marcado como solo-admin desaparece del DOM (no solo se oculta).
  document.querySelectorAll<HTMLElement>('[data-solo-admin]').forEach(nodo => nodo.remove());
  document.querySelectorAll<HTMLElement>('.nav-link[data-vista="admin"]').forEach(nodo => nodo.remove());

  // Atajos que apuntan a vistas que ya no existen.
  document.querySelectorAll<HTMLElement>('[data-ir]').forEach(nodo => {
    const destino = nodo.dataset.ir;
    if (destino && !document.getElementById(`vista-${destino}`)) nodo.remove();
  });

  // Si la vista activa desapareció, regresamos a Inicio.
  const activa = document.querySelector<HTMLElement>('.vista.activa');
  if (!activa || !document.body.contains(activa)) {
    document.querySelectorAll<HTMLElement>('.vista').forEach(v => v.classList.remove('activa'));
    document.getElementById('vista-inicio')?.classList.add('activa');
    document.querySelector('.nav-link[data-vista="inicio"]')?.setAttribute('aria-current', 'page');
  }
}
