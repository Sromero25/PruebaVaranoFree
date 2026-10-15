/**
 * loginView.ts
 * ----------------------------------------------------------------------------
 * Pantalla de acceso (se dibuja sobre toda la app) y barra de sesión.
 *
 * - Primera vez (no hay usuarios): pide crear el administrador.
 * - Después: inicio de sesión con opción "mantener sesión iniciada".
 */

import { hayUsuarios, crearUsuario, iniciarSesion, cerrarSesion, obtenerUsuarioActual } from '../auth.js';
import { mensajeDeError } from '../herramientas.js';

export async function mostrarLogin(): Promise<void> {
  const primeraVez = !(await hayUsuarios());

  return new Promise<void>(resolve => {
    const capa = document.createElement('div');
    capa.className = 'x-login';
    capa.innerHTML = `
      <form class="x-login-card x-form" autocomplete="on">
        <h2>Taller de Calzado</h2>
        <p class="x-nota">${primeraVez
          ? 'Bienvenido. Crea la cuenta de administrador para empezar.'
          : 'Inicia sesión para continuar.'}</p>
        ${primeraVez ? '<label class="x-campo">Nombre<input name="nombre" required maxlength="60" autocomplete="name"></label>' : ''}
        <label class="x-campo">Usuario<input name="usuario" required maxlength="30" autocomplete="username" autocapitalize="none"></label>
        <label class="x-campo">Contraseña<input name="password" type="password" required maxlength="128" autocomplete="${primeraVez ? 'new-password' : 'current-password'}"></label>
        ${primeraVez ? '<label class="x-campo">Repite la contraseña<input name="password2" type="password" required maxlength="128" autocomplete="new-password"></label>' : ''}
        <label class="x-check"><input name="recordar" type="checkbox" checked> Mantener sesión iniciada en este equipo</label>
        <p class="x-error" role="alert"></p>
        <button type="submit" class="x-btn">${primeraVez ? 'Crear administrador y entrar' : 'Entrar'}</button>
      </form>`;
    document.body.append(capa);

    const form = capa.querySelector('form') as HTMLFormElement;
    const msg = capa.querySelector('.x-error') as HTMLElement;
    const boton = capa.querySelector('button[type="submit"]') as HTMLButtonElement;
    const campo = (n: string): string => (form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '';
    (form.elements.namedItem(primeraVez ? 'nombre' : 'usuario') as HTMLInputElement).focus();

    form.addEventListener('submit', async e => {
      e.preventDefault();
      msg.textContent = '';
      boton.disabled = true;
      try {
        if (primeraVez) {
          if (campo('password') !== campo('password2')) throw new Error('Las contraseñas no coinciden.');
          await crearUsuario({ usuario: campo('usuario'), nombre: campo('nombre'), password: campo('password'), rol: 'admin' });
        }
        await iniciarSesion(campo('usuario'), campo('password'), (form.elements.namedItem('recordar') as HTMLInputElement).checked);
        capa.remove();
        resolve();
      } catch (err) {
        msg.textContent = mensajeDeError(err);
        boton.disabled = false;
      }
    });
  });
}

/** Muestra quién inició sesión y el botón "Cerrar sesión" en el menú lateral. */
export function montarBarraSesion(): void {
  const u = obtenerUsuarioActual();
  if (!u) return;
  const cont = document.querySelector('.nav-link')?.parentElement ?? document.body;

  const caja = document.createElement('div');
  caja.className = 'x-sesion';
  const quien = document.createElement('span');
  quien.textContent = `${u.Nombre} · ${u.Rol === 'admin' ? 'Administrador' : 'Usuario'}`;
  const salir = document.createElement('button');
  salir.type = 'button';
  salir.textContent = 'Cerrar sesión';
  salir.addEventListener('click', () => { void cerrarSesion().then(() => location.reload()); });
  caja.append(quien, salir);
  cont.append(caja);
}