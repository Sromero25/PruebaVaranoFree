import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>;

const LARGO_CLAVE = 64;

export async function hashPassword(password: string): Promise<{ sal: string; hash: string }> {
  const sal = randomBytes(16).toString('hex');
  const hash = await scrypt(password, sal, LARGO_CLAVE);
  return { sal, hash: hash.toString('hex') };
}

export async function verificarPassword(password: string, sal: string, hashEsperado: string): Promise<boolean> {
  const calculado = await scrypt(password, sal, LARGO_CLAVE);
  const esperado = Buffer.from(hashEsperado, 'hex');
  if (esperado.length !== calculado.length) return false;
  return timingSafeEqual(calculado, esperado);
}
