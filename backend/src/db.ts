import { createPool, type Pool, type PoolConnection } from 'mysql2/promise';
import { config } from './config.js';

export const pool: Pool = createPool({
  ...config.db,
  waitForConnections: true,
  queueLimit: 0,
  charset: 'utf8mb4'
});

/** Ejecuta una función dentro de una transacción y libera la conexión siempre. */
export async function conTransaccion<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (error) {
    try { await conn.rollback(); } catch { /* la conexión ya no sirve */ }
    throw error;
  } finally {
    conn.release();
  }
}
