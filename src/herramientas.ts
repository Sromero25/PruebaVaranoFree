/**
 * herramientas.ts
 * ----------------------------------------------------------------------------
 * Utilidades compartidas: toast, formato de dinero/fechas, escape de HTML
 * (protección contra XSS), diálogos de captura y helpers de DOM.
 */

/** Pares a partir de los cuales una talla se considera "bajo stock". */
export const UMBRAL_STOCK_BAJO = 5;

/** Atajo para `document.getElementById`. */
export function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/**
 * Escapa texto para insertarlo de forma segura dentro de `innerHTML`.
 * TODO dato escrito por una persona (nombres, direcciones...) debe pasar por aquí.
 */
export function esc(valor: unknown): string {
  const mapa: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(valor ?? '').replace(/[&<>"']/g, c => mapa[c] ?? c);
}

/** Texto amigable para mostrar un error al usuario. */
export function mensajeDeError(e: unknown): string {
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado.';
}

export function notificar(mensaje: string, esError = false): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = mensaje;
  toast.className = `toast visible ${esError ? 'error' : ''}`;
  setTimeout(() => { toast.className = 'toast'; }, 3200);
}

export const formatearDinero = (monto: number): string =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);

export const formatearFecha = (fecha: Date): string =>
  new Date(fecha).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Fecha -> "AAAA-MM-DD" (valor de <input type="date">). */
export function aInputFecha(fecha: Date): string {
  const f = new Date(fecha);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
}

/** "AAAA-MM-DD" -> Date (a mediodía para evitar saltos por zona horaria). */
export function desdeInputFecha(valor: string): Date {
  return new Date(`${valor}T12:00:00`);
}

/** Agrupa tallas consecutivas: [18,19,20,25] -> "18–20, 25". */
export function compactarTallas(tallas: number[]): string {
  const orden = [...new Set(tallas)].sort((a, b) => a - b);
  const partes: string[] = [];
  let ini: number | undefined;
  let prev = 0;
  const cerrar = (): void => {
    if (ini !== undefined) partes.push(ini === prev ? `${ini}` : `${ini}–${prev}`);
  };
  for (const t of orden) {
    if (ini !== undefined && t === prev + 1) { prev = t; continue; }
    cerrar();
    ini = t;
    prev = t;
  }
  cerrar();
  return partes.join(', ');
}

/** Devuelve la sección `#vista-<nombre>`; si no existe, la crea junto a las demás vistas. */
export function obtenerOCrearVista(nombre: string): HTMLElement {
  let v = document.getElementById(`vista-${nombre}`);
  if (!v) {
    v = document.createElement('section');
    v.id = `vista-${nombre}`;
    v.className = 'vista';
    const ref = document.querySelector('.vista');
    (ref?.parentElement ?? document.body).append(v);
  }
  return v;
}

// ---------------------------------------------------------------- diálogo

export interface CampoDialogo {
  nombre: string;
  etiqueta: string;
  tipo?: 'text' | 'number' | 'password' | 'select' | 'tel' | 'email' | 'date';
  valor?: string | number;
  opciones?: { valor: string; texto: string }[];
  requerido?: boolean;
  min?: number;
  step?: string;
  maxLength?: number;
}

/**
 * Abre un cuadro de diálogo con campos y devuelve lo capturado (o `null` si se
 * cancela). Construye el DOM con `textContent`, así que es seguro ante XSS.
 */
export function pedirCampos(
  titulo: string,
  campos: CampoDialogo[],
  textoOk = 'Guardar'
): Promise<Record<string, string> | null> {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'x-dialogo';
    const form = document.createElement('form');
    form.className = 'x-form';

    const h = document.createElement('h3');
    h.textContent = titulo;
    form.append(h);

    for (const c of campos) {
      const label = document.createElement('label');
      label.className = 'x-campo';
      label.append(document.createTextNode(c.etiqueta));

      let entrada: HTMLInputElement | HTMLSelectElement;
      if (c.tipo === 'select') {
        const sel = document.createElement('select');
        for (const o of c.opciones ?? []) sel.add(new Option(o.texto, o.valor));
        if (c.valor !== undefined) sel.value = String(c.valor);
        entrada = sel;
      } else {
        const inp = document.createElement('input');
        inp.type = c.tipo ?? 'text';
        if (c.valor !== undefined) inp.value = String(c.valor);
        if (c.min !== undefined) inp.min = String(c.min);
        if (c.step) inp.step = c.step;
        if (c.maxLength) inp.maxLength = c.maxLength;
        if (c.tipo === 'password') inp.autocomplete = 'new-password';
        entrada = inp;
      }
      entrada.name = c.nombre;
      entrada.required = c.requerido ?? true;
      label.append(entrada);
      form.append(label);
    }

    const acciones = document.createElement('div');
    acciones.className = 'x-acciones';
    const cancelar = document.createElement('button');
    cancelar.type = 'button';
    cancelar.className = 'x-btn-sec';
    cancelar.textContent = 'Cancelar';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'x-btn';
    ok.textContent = textoOk;
    acciones.append(cancelar, ok);
    form.append(acciones);

    let resultado: Record<string, string> | null = null;
    cancelar.addEventListener('click', () => dlg.close());
    form.addEventListener('submit', e => {
      e.preventDefault();
      const datos: Record<string, string> = {};
      for (const c of campos) {
        const campo = form.elements.namedItem(c.nombre) as HTMLInputElement | HTMLSelectElement | null;
        datos[c.nombre] = campo?.value ?? '';
      }
      resultado = datos;
      dlg.close();
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(resultado); });

    dlg.append(form);
    document.body.append(dlg);
    dlg.showModal();
  });
}