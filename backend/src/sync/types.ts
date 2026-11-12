import { z } from 'zod';

const id = z.string().trim().min(1).max(36);
const fecha = z.string().trim().min(1).max(40);
const fechaOpcional = z.string().trim().max(40).nullable().optional();
const entero = z.number().int();
const decimal = z.number().finite();

export const entidades = [
  'cliente',
  'producto',
  'talla',
  'proveedor',
  'materia_prima',
  'producto_costo',
  'venta',
  'compra',
  'ajuste_stock',
  'ajuste_stock_material'
] as const;

export type Entidad = (typeof entidades)[number];

export const cambioSchema = z.object({
  id: id.optional(),
  entidad: z.enum(entidades),
  entidad_id: id,
  operacion: z.enum(['upsert', 'delete']).default('upsert'),
  payload: z.unknown(),
  idempotency_key: z.string().max(100).optional()
});

export const pushSchema = z.object({
  device_id: id.optional(),
  device_name: z.string().trim().max(80).optional(),
  cambios: z.array(cambioSchema).max(500)
});

export type CambioRecibido = z.infer<typeof cambioSchema>;

export const clienteSchema = z.object({
  id,
  nombre: z.string().trim().min(1).max(60),
  apellido: z.string().trim().max(60).nullable().optional(),
  telefono: z.string().trim().max(25).nullable().optional(),
  direccion: z.string().trim().max(500).nullable().optional(),
  created_at: fechaOpcional,
  updated_at: fechaOpcional,
  deleted_at: fechaOpcional,
  version: entero.optional()
});

export const productoSchema = z.object({
  id,
  modelo: z.string().trim().min(1).max(40),
  precio_base: decimal.min(0),
  costo_base: decimal.min(0).optional(),
  created_at: fechaOpcional,
  updated_at: fechaOpcional,
  deleted_at: fechaOpcional,
  version: entero.optional()
});

export const productoCostoSchema = z.object({
  id,
  producto_id: id,
  costo: decimal.min(0),
  vigente_desde: fechaOpcional,
  usuario_id: id.nullable().optional(),
  dispositivo_id: id.nullable().optional(),
  created_at: fechaOpcional
});

export const tallaSchema = z.object({
  id,
  producto_id: id,
  talla: decimal,
  stock: entero.optional(),
  created_at: fechaOpcional,
  updated_at: fechaOpcional,
  deleted_at: fechaOpcional,
  version: entero.optional()
});

export const proveedorSchema = z.object({
  id,
  nombre: z.string().trim().min(1).max(80),
  telefono: z.string().trim().max(25).nullable().optional(),
  direccion: z.string().trim().max(120).nullable().optional(),
  correo: z.string().trim().max(80).nullable().optional(),
  created_at: fechaOpcional,
  updated_at: fechaOpcional,
  deleted_at: fechaOpcional,
  version: entero.optional()
});

export const materialSchema = z.object({
  id,
  nombre: z.string().trim().min(1).max(80),
  categoria: z.string().trim().max(60).nullable().optional(),
  precio: decimal.min(0),
  stock: decimal.optional(),
  created_at: fechaOpcional,
  updated_at: fechaOpcional,
  deleted_at: fechaOpcional,
  version: entero.optional()
});

export const detalleVentaSchema = z.object({
  id,
  talla_id: id,
  cantidad: entero.positive(),
  precio_unitario: decimal.min(0),
  /** Costo del par al momento de la venta (instantánea histórica). */
  costo_unitario: decimal.min(0).optional()
});

export const ventaSchema = z.object({
  id,
  cliente_id: id,
  fecha,
  total: decimal.min(0),
  usuario_id: id.nullable().optional(),
  estado: z.enum(['activa', 'anulada']).optional(),
  anulada_en: fechaOpcional,
  anulada_por: id.nullable().optional(),
  deleted_at: fechaOpcional,
  version: entero.optional(),
  correccion: z.boolean().optional(),
  detalles: z.array(detalleVentaSchema).optional()
});

export const detalleCompraSchema = z.object({
  id,
  materia_prima_id: id,
  cantidad: decimal.positive(),
  precio_unitario: decimal.min(0)
});

export const compraSchema = z.object({
  id,
  proveedor_id: id,
  fecha,
  total: decimal.min(0),
  usuario_id: id.nullable().optional(),
  estado: z.enum(['activa', 'anulada']).optional(),
  anulada_en: fechaOpcional,
  anulada_por: id.nullable().optional(),
  deleted_at: fechaOpcional,
  version: entero.optional(),
  detalles: z.array(detalleCompraSchema).optional()
});

export const ajusteStockSchema = z.object({
  talla_id: id,
  stock: entero.min(0),
  motivo: z.string().trim().max(120).optional()
});

export const ajusteStockMaterialSchema = z.object({
  materia_prima_id: id,
  stock: decimal.min(0),
  motivo: z.string().trim().max(120).optional()
});

export interface ResultadoCambio {
  id?: string;
  entidad: string;
  entidad_id: string;
  estado: 'aplicado' | 'duplicado' | 'conflicto' | 'error';
  mensaje?: string;
  advertencias?: Advertencia[];
  seq?: number;
}

export interface Advertencia {
  tipo: 'stock_negativo';
  talla_id?: string;
  materia_prima_id?: string;
  stock_resultante: number;
}
