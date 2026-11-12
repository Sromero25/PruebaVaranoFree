/**
 * estadoView.ts
 * ----------------------------------------------------------------------------
 * Indicador de sincronización en la barra lateral: en línea/sin conexión,
 * cambios pendientes, conflictos y botón para sincronizar ahora.
 */

import { obtenerEstadoSync, sincronizarAhora, reintentarConflictos } from './engine.js';

function crearBoton(texto: string, clase = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `x-btn-mini ${clase}`.trim();
  b.textContent = texto;
  return b;
}

export function montarEstadoSync(): void {
  const pie = document.querySelector('.sidebar-foot');
  if (!pie) return;

  pie.innerHTML = '';
  const caja = document.createElement('div');
  caja.className = 'x-sync';

  const estado = document.createElement('div');
  estado.className = 'x-sync-estado';
  estado.id = 'sync-estado';

  const acciones = document.createElement('div');
  acciones.className = 'x-sync-acciones';

  const ahora = crearBoton('Sincronizar ahora');
  ahora.id = 'btn-sync-ahora';
  ahora.addEventListener('click', () => { void sincronizarAhora(true); });

  const conflictos = crearBoton('Reintentar conflictos', 'x-peligro');
  conflictos.id = 'btn-sync-conflictos';
  conflictos.hidden = true;
  conflictos.addEventListener('click', () => { void reintentarConflictos(); });

  acciones.append(ahora, conflictos);
  caja.append(estado, acciones);
  pie.append(caja);

  window.addEventListener('varano-sync', () => { void actualizarEstadoSync(); });
  window.addEventListener('online', () => { void actualizarEstadoSync(); });
  window.addEventListener('offline', () => { void actualizarEstadoSync(); });

  void actualizarEstadoSync();
}

export async function actualizarEstadoSync(): Promise<void> {
  const cont = document.getElementById('sync-estado');
  const btnConflictos = document.getElementById('btn-sync-conflictos') as HTMLButtonElement | null;
  if (!cont) return;

  const e = await obtenerEstadoSync();
  const partes: string[] = [];
  partes.push(e.online ? 'En línea' : 'Sin conexión');
  if (e.sincronizando) partes.push('Sincronizando…');
  if (e.pendientes > 0) partes.push(`${e.pendientes} pendiente${e.pendientes === 1 ? '' : 's'}`);
  if (e.conflictos > 0) partes.push(`${e.conflictos} conflicto${e.conflictos === 1 ? '' : 's'}`);
  if (e.ultimoError) partes.push(e.ultimoError);

  cont.textContent = partes.join(' · ');
  cont.className = `x-sync-estado ${e.online ? 'x-online' : 'x-offline'}${e.conflictos ? ' x-con-conflictos' : ''}`;
  if (btnConflictos) btnConflictos.hidden = e.conflictos === 0;
}
