import { pool } from '../db.js';

export interface CambioPull {
  seq: number;
  entidad: string;
  entidad_id: string;
  operacion: 'upsert' | 'delete';
  payload: unknown;
  fecha: string;
  dispositivo_id: string | null;
}

export interface RespuestaPull {
  cambios: CambioPull[];
  nextSeq: number;
  hasMore: boolean;
}

export async function procesarPull(desde: number, limite: number): Promise<RespuestaPull> {
  const [rows]: any = await pool.query(
    `SELECT seq, entidad, entidad_id, operacion, payload, fecha, dispositivo_id
       FROM sync_cambios
      WHERE seq > ?
      ORDER BY seq ASC
      LIMIT ?`,
    [desde, limite + 1]
  );

  const hayMas = rows.length > limite;
  const usadas = hayMas ? rows.slice(0, limite) : rows;

  const cambios: CambioPull[] = usadas.map((r: any) => ({
    seq: Number(r.seq),
    entidad: r.entidad,
    entidad_id: r.entidad_id,
    operacion: r.operacion,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    fecha: r.fecha instanceof Date ? r.fecha.toISOString() : String(r.fecha),
    dispositivo_id: r.dispositivo_id ?? null
  }));

  return {
    cambios,
    nextSeq: cambios.length ? cambios[cambios.length - 1].seq : desde,
    hasMore: hayMas
  };
}
