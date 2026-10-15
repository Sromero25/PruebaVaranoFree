/**
 * utils.ts
 * ----------------------------------------------------------------------------
 * Utilidades compartidas por todas las vistas: notificaciones (toast),
 * formateo de dinero y fechas, y constantes de negocio.
 */

/** Cantidad de pares a partir de la cual una talla se considera "bajo stock". */
export const UMBRAL_STOCK_BAJO = 5;

/**
 * Muestra una notificación temporal (toast) en pantalla.
 * Requiere un elemento `#toast` en el HTML.
 *
 * @param mensaje  Texto a mostrar.
 * @param esError  Si es `true`, aplica el estilo de error.
 */
export function notificar(mensaje: string, esError = false): void {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = mensaje;
  toast.className = `toast visible ${esError ? 'error' : ''}`;

  setTimeout(() => {
    toast.className = 'toast';
  }, 3200);
}

/** Formatea un número como moneda mexicana. Ej: 1250 -> "$1,250.00". */
export const formatearDinero = (monto: number): string =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);

/** Formatea una fecha en formato corto DD/MM/AAAA. */
export const formatearFecha = (fecha: Date): string =>
  new Date(fecha).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });