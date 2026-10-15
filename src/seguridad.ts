/**
 * seguridad.ts
 * ----------------------------------------------------------------------------
 * Primitivas criptográficas (Web Crypto API) para contraseñas y sesiones.
 *
 * - Contraseñas: PBKDF2-SHA256 con sal aleatoria y 150 000 iteraciones.
 * - Tokens de sesión: 256 bits aleatorios; en la BD sólo se guarda su SHA-256.
 *
 * Nota: `crypto.subtle` sólo existe en contextos seguros (https o localhost).
 */

const ITERACIONES = 150_000;
const codificador = new TextEncoder();

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Este navegador requiere https o localhost para usar el inicio de sesión.');
  }
  return globalThis.crypto.subtle;
}

function aHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function deHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Genera `bytes` bytes aleatorios criptográficamente seguros, en hexadecimal. */
export function generarAleatorioHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Deriva el hash de una contraseña con la sal indicada (hex). */
export async function hashPassword(password: string, salHex: string): Promise<string> {
  const clave = await subtle().importKey('raw', codificador.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: deHex(salHex) as BufferSource, iterations: ITERACIONES },
    clave,
    256
  );
  return aHex(bits);
}

/** SHA-256 de un texto, en hexadecimal. */
export async function sha256Hex(texto: string): Promise<string> {
  return aHex(await subtle().digest('SHA-256', codificador.encode(texto)));
}

/** Comparación en tiempo constante de dos cadenas. */
export function compararSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}