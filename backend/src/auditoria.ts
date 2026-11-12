import crypto from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';

export interface Ejecutor {
  query: (sql: string, values?: unknown[]) => Promise<[unknown, unknown]>;
}

export interface DatosAuditoria {
  usuarioId: string;
  dispositivoId?: string | null;
  entidad: string;
  entidadId: string;
  accion: string;
  antes?: unknown;
  despues?: unknown;
}

export async function auditar(conn: Ejecutor, d: DatosAuditoria): Promise<void> {
  await conn.query(
    `INSERT INTO auditoria
       (id, usuario_id, dispositivo_id, entidad, entidad_id, accion, antes_json, despues_json, fecha)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      crypto.randomUUID(),
      d.usuarioId,
      d.dispositivoId ?? null,
      d.entidad,
      d.entidadId,
      d.accion,
      d.antes === undefined ? null : JSON.stringify(d.antes),
      d.despues === undefined ? null : JSON.stringify(d.despues)
    ]
  );
}

export interface DatosCambio {
  entidad: string;
  entidadId: string;
  operacion: 'upsert' | 'delete';
  payload: unknown;
  usuarioId: string;
  dispositivoId?: string | null;
}

export async function registrarCambio(conn: Ejecutor, d: DatosCambio): Promise<number> {
  const [resultado] = await conn.query(
    `INSERT INTO sync_cambios
       (entidad, entidad_id, operacion, payload, usuario_id, dispositivo_id, fecha)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [
      d.entidad,
      d.entidadId,
      d.operacion,
      JSON.stringify(d.payload),
      d.usuarioId,
      d.dispositivoId ?? null
    ]
  ) as [ResultSetHeader, unknown];
  return Number(resultado.insertId);
}
