/**
 * loginView.ts
 * ----------------------------------------------------------------------------
 * Pantalla de acceso (se dibuja sobre toda la app) y barra de sesión.
 *
 * - Solo pide crear el administrador cuando el SERVIDOR confirma que no hay
 *   usuarios. Si la API no responde, muestra el inicio de sesión con un aviso,
 *   nunca la pantalla de "crear cuenta".
 * - Después: pestañas "Iniciar sesión" y "Crear cuenta".
 * - El registro público crea usuarios normales. Solo con un código de
 *   invitación válido (ADMIN_INVITE_CODE) se crea un administrador.
 */

import {
  estadoSistema, crearUsuario, iniciarSesion, cerrarSesion,
  obtenerUsuarioActual, registrarUsuario, type EstadoSistema
} from '../auth.js';
import { mensajeDeError } from '../herramientas.js';

const campo = (form: HTMLFormElement, nombre: string): string =>
  (form.elements.namedItem(nombre) as HTMLInputElement | null)?.value ?? '';

const marcado = (form: HTMLFormElement, nombre: string): boolean =>
  (form.elements.namedItem(nombre) as HTMLInputElement | null)?.checked ?? false;

const botonEnvio = (form: HTMLFormElement): HTMLButtonElement =>
  form.querySelector('button[type="submit"]') as HTMLButtonElement;

const mensajeError = (form: HTMLFormElement): HTMLElement =>
  form.querySelector('.x-error') as HTMLElement;

export async function mostrarLogin(): Promise<void> {
  // Pintamos algo de inmediato: si el servidor está despertando, el usuario ve
  // que la app está trabajando en vez de una pantalla en blanco.
  const capa = document.createElement('div');
  capa.className = 'x-login';
  capa.innerHTML = htmlConectando();
  document.body.append(capa);

  const avisoLento = window.setTimeout(() => {
    const texto = capa.querySelector('#txt-conectando');
    if (texto) {
      texto.textContent = 'El servidor está despertando. La primera conexión del día puede tardar hasta un minuto…';
    }
  }, 6_000);

  let estado: EstadoSistema;
  try {
    estado = await estadoSistema();
  } catch {
    estado = 'sin_conexion';
  }
  window.clearTimeout(avisoLento);

  const sinConexion = estado === 'sin_conexion';
  capa.innerHTML = estado === 'sin_usuarios' ? htmlPrimeraVez() : htmlAcceso(sinConexion);

  return new Promise<void>(resolve => {
    const entrar = (): void => {
      capa.remove();
      resolve();
    };

    if (estado === 'sin_usuarios') montarPrimeraVez(capa, entrar);
    else montarAcceso(capa, entrar, sinConexion);
  });
}

// ---------------------------------------------------------------- conectando

function htmlConectando(): string {
  return `
    <div class="x-login-card x-conectando" role="status" aria-live="polite">
      <h2>Taller de Calzado</h2>
      <p class="x-nota" id="txt-conectando">Conectando con el servidor…</p>
      <div class="x-spinner" aria-hidden="true"></div>
    </div>`;
}

// ---------------------------------------------------------------- primera vez

function htmlPrimeraVez(): string {
  return `
    <form class="x-login-card x-form" autocomplete="on" id="form-bootstrap">
      <h2>Taller de Calzado</h2>
      <p class="x-nota">Bienvenido. Crea la cuenta de administrador para empezar. Después podrás dar de alta a tu equipo.</p>
      <label class="x-campo">Nombre<input name="nombre" required maxlength="60" autocomplete="name"></label>
      <label class="x-campo">Usuario<input name="usuario" required maxlength="30" autocomplete="username" autocapitalize="none"></label>
      <label class="x-campo">Contraseña<input name="password" type="password" required maxlength="128" autocomplete="new-password"></label>
      <label class="x-campo">Repite la contraseña<input name="password2" type="password" required maxlength="128" autocomplete="new-password"></label>
      <label class="x-check"><input name="recordar" type="checkbox" checked> Mantener sesión iniciada en este equipo</label>
      <p class="x-error" role="alert"></p>
      <button type="submit" class="x-btn">Crear administrador y entrar</button>
    </form>`;
}

function montarPrimeraVez(capa: HTMLElement, entrar: () => void): void {
  const form = capa.querySelector<HTMLFormElement>('form')!;
  const msg = mensajeError(form);
  const boton = botonEnvio(form);
  (form.elements.namedItem('nombre') as HTMLInputElement).focus();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    msg.textContent = '';
    boton.disabled = true;
    try {
      if (campo(form, 'password') !== campo(form, 'password2')) {
        throw new Error('Las contraseñas no coinciden.');
      }
      await crearUsuario({
        usuario: campo(form, 'usuario'),
        nombre: campo(form, 'nombre'),
        password: campo(form, 'password'),
        rol: 'admin'
      });
      await iniciarSesion(campo(form, 'usuario'), campo(form, 'password'), marcado(form, 'recordar'));
      entrar();
    } catch (err) {
      msg.textContent = mensajeDeError(err);
      boton.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- acceso

function htmlAcceso(sinConexion: boolean): string {
  return `
    <div class="x-login-card">
      <h2>Taller de Calzado</h2>
      <p class="x-nota">Elige cómo entrar. El usuario normal trabaja con ventas guiadas; el administrador tiene control total.</p>

      ${sinConexion ? `<div class="x-aviso-servidor" role="alert">
        <strong>Sin conexión con el servidor</strong>
        <p>No se pudo consultar el sistema. Si el servicio estuvo inactivo, la primera conexión puede tardar hasta un minuto: pulsa <em>Reintentar</em>. Si ya iniciaste sesión antes, puedes seguir trabajando sin conexión.</p>
        <button type="button" class="x-btn-sec" id="btn-reintentar">Reintentar conexión</button>
      </div>` : `
      <div class="x-login-tabs" role="tablist" aria-label="Acceso">
        <button type="button" class="x-login-tab activo" data-tab="entrar" role="tab" aria-selected="true">Iniciar sesión</button>
        <button type="button" class="x-login-tab" data-tab="crear" role="tab" aria-selected="false">Crear cuenta</button>
      </div>`}

      <form class="x-form" id="form-login" autocomplete="on">
        <label class="x-campo">Usuario<input name="usuario" required maxlength="30" autocomplete="username" autocapitalize="none"></label>
        <label class="x-campo">Contraseña<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label>
        <label class="x-check"><input name="recordar" type="checkbox" checked> Mantener sesión iniciada en este equipo</label>
        <p class="x-error" role="alert"></p>
        <button type="submit" class="x-btn">Entrar</button>
      </form>

      <form class="x-form" id="form-registro" autocomplete="on" hidden>
        <label class="x-campo">Nombre<input name="nombre" required maxlength="60" autocomplete="name"></label>
        <label class="x-campo">Usuario<input name="usuario" required maxlength="30" autocomplete="username" autocapitalize="none"></label>
        <label class="x-campo">Contraseña (mínimo 8 caracteres)<input name="password" type="password" required maxlength="128" autocomplete="new-password"></label>
        <label class="x-campo">Repite la contraseña<input name="password2" type="password" required maxlength="128" autocomplete="new-password"></label>
        <label class="x-campo">Código de administrador (opcional)<input name="codigo" maxlength="100" autocomplete="off"></label>
        <p class="x-nota">El registro público crea usuarios normales. El código de administrador solo lo entrega el administrador del taller.</p>
        <label class="x-check"><input name="recordar" type="checkbox" checked> Mantener sesión iniciada en este equipo</label>
        <p class="x-error" role="alert"></p>
        <button type="submit" class="x-btn">Crear cuenta y entrar</button>
      </form>
    </div>`;
}

function montarAcceso(capa: HTMLElement, entrar: () => void, sinConexion: boolean): void {
  const login = capa.querySelector<HTMLFormElement>('#form-login')!;
  const registro = capa.querySelector<HTMLFormElement>('#form-registro')!;

  capa.querySelector<HTMLButtonElement>('#btn-reintentar')?.addEventListener('click', () => location.reload());

  capa.querySelectorAll<HTMLButtonElement>('.x-login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const crear = tab.dataset.tab === 'crear';
      capa.querySelectorAll<HTMLButtonElement>('.x-login-tab').forEach(t => {
        t.classList.toggle('activo', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      });
      login.hidden = crear;
      registro.hidden = !crear;
      (registro.hidden ? login : registro).querySelector<HTMLInputElement>('input')?.focus();
    });
  });

  (login.elements.namedItem('usuario') as HTMLInputElement).focus();

  login.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = mensajeError(login);
    const boton = botonEnvio(login);
    msg.textContent = '';
    boton.disabled = true;
    try {
      await iniciarSesion(campo(login, 'usuario'), campo(login, 'password'), marcado(login, 'recordar'));
      entrar();
    } catch (err) {
      msg.textContent = mensajeDeError(err);
      boton.disabled = false;
    }
  });

  if (sinConexion) return;

  registro.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = mensajeError(registro);
    const boton = botonEnvio(registro);
    msg.textContent = '';
    boton.disabled = true;
    try {
      if (campo(registro, 'password') !== campo(registro, 'password2')) {
        throw new Error('Las contraseñas no coinciden.');
      }
      await registrarUsuario({
        usuario: campo(registro, 'usuario'),
        nombre: campo(registro, 'nombre'),
        password: campo(registro, 'password'),
        codigoAdmin: campo(registro, 'codigo'),
        recordar: marcado(registro, 'recordar')
      });
      entrar();
    } catch (err) {
      msg.textContent = mensajeDeError(err);
      boton.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- barra lateral

/** Muestra quién inició sesión y el botón "Cerrar sesión" en el menú lateral. */
export function montarBarraSesion(): void {
  const u = obtenerUsuarioActual();
  if (!u) return;
  const cont = document.querySelector('.nav-link')?.parentElement ?? document.body;

  const caja = document.createElement('div');
  caja.className = 'x-sesion';
  const quien = document.createElement('span');
  quien.textContent = u.Nombre;
  const rol = document.createElement('span');
  rol.className = 'x-rol';
  rol.textContent = u.Rol === 'admin' ? 'Administrador' : 'Usuario';
  quien.append(rol);
  quien.title = `@${u.Usuario}`;
  const salir = document.createElement('button');
  salir.type = 'button';
  salir.textContent = 'Cerrar sesión';
  salir.addEventListener('click', () => { void cerrarSesion().then(() => location.reload()); });
  caja.append(quien, salir);
  cont.append(caja);
}
