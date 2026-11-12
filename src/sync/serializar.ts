/**
 * serializar.ts
 * ----------------------------------------------------------------------------
 * Traduce entre el modelo local en español (IDVenta, IDCliente...) y el
 * contrato snake_case del backend.
 */

import type {
  Cliente, Compra, CompraDetalle, InventarioMPrima, Producto, ProductoCosto,
  Proveedor, Tallas, Venta, VentaDetalle
} from '../db.js';

const ahora = (): string => new Date().toISOString();
const fechaIso = (valor: Date | string | undefined | null): string | null => {
  if (!valor) return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
};

export function payloadCliente(c: Cliente): unknown {
  return {
    id: c.IDCliente,
    nombre: c.Nombre,
    apellido: c.Apellido || null,
    telefono: c.Telefono || null,
    direccion: c.Direccion || null,
    updated_at: c.updated_at ?? ahora(),
    deleted_at: c.deleted_at ?? null,
    version: c.version ?? 1
  };
}

export function payloadProducto(p: Producto): unknown {
  return {
    id: p.IDModelo,
    modelo: p.Modelo,
    precio_base: p.PrecioBase,
    costo_base: p.CostoBase ?? 0,
    updated_at: p.updated_at ?? ahora(),
    deleted_at: p.deleted_at ?? null,
    version: p.version ?? 1
  };
}

export function payloadProductoCosto(c: ProductoCosto): unknown {
  return {
    id: c.IDCosto,
    producto_id: c.IDModelo,
    costo: c.Costo,
    vigente_desde: c.VigenteDesde,
    updated_at: c.updated_at ?? ahora(),
    deleted_at: c.deleted_at ?? null,
    version: c.version ?? 1
  };
}

export function payloadTalla(t: Tallas): unknown {
  return {
    id: t.IDTalla,
    producto_id: t.IDModelo,
    talla: t.Talla,
    stock: t.Stock,
    updated_at: t.updated_at ?? ahora(),
    deleted_at: t.deleted_at ?? null,
    version: t.version ?? 1
  };
}

export function payloadProveedor(p: Proveedor): unknown {
  return {
    id: p.IDProveedor,
    nombre: p.Nombre,
    telefono: p.Telefono || null,
    direccion: p.Direccion || null,
    correo: p.Correo || null,
    updated_at: p.updated_at ?? ahora(),
    deleted_at: p.deleted_at ?? null,
    version: p.version ?? 1
  };
}

export function payloadMaterial(m: InventarioMPrima): unknown {
  return {
    id: m.IDItem,
    nombre: m.Nombre,
    categoria: m.Categoria || null,
    precio: m.Precio,
    stock: m.Stock,
    updated_at: m.updated_at ?? ahora(),
    deleted_at: m.deleted_at ?? null,
    version: m.version ?? 1
  };
}

export function payloadVenta(v: Venta, detalles: VentaDetalle[], correccion = false): unknown {
  return {
    id: v.IDVenta,
    cliente_id: v.IDCliente,
    fecha: fechaIso(v.Fecha) ?? ahora(),
    total: v.Total,
    usuario_id: v.UsuarioID ?? null,
    estado: v.Estado ?? 'activa',
    anulada_en: v.AnuladaEn ?? null,
    anulada_por: v.AnuladaPor ?? null,
    deleted_at: v.deleted_at ?? null,
    version: v.version ?? 1,
    correccion: correccion || undefined,
    detalles: detalles.map(d => ({
      id: d.IDDetalle,
      talla_id: d.IDTalla,
      cantidad: d.Cantidad,
      precio_unitario: d.PrecioUnitario,
      costo_unitario: d.CostoUnitario ?? 0
    }))
  };
}

export function payloadCompra(c: Compra, detalles: CompraDetalle[]): unknown {
  return {
    id: c.IDCompra,
    proveedor_id: c.IDProveedor,
    fecha: fechaIso(c.Fecha) ?? ahora(),
    total: c.Total,
    usuario_id: c.UsuarioID ?? null,
    estado: c.Estado ?? 'activa',
    anulada_en: c.AnuladaEn ?? null,
    anulada_por: c.AnuladaPor ?? null,
    deleted_at: c.deleted_at ?? null,
    version: c.version ?? 1,
    detalles: detalles.map(d => ({
      id: d.IDDetalle,
      materia_prima_id: d.IDItem,
      cantidad: d.Cantidad,
      precio_unitario: d.PrecioUnitario
    }))
  };
}

// ---------------------------------------------------------------- pull

export function clienteDesdePayload(p: any): Cliente {
  return {
    IDCliente: p.id,
    Nombre: p.nombre ?? '',
    Apellido: p.apellido ?? '',
    Telefono: p.telefono ?? '',
    Direccion: p.direccion ?? '',
    updated_at: p.updated_at ?? ahora(),
    deleted_at: p.deleted_at ?? null,
    version: Number(p.version ?? 1)
  };
}

export function productoDesdePayload(p: any): Producto {
  return {
    IDModelo: p.id,
    Modelo: p.modelo ?? '',
    PrecioBase: Number(p.precio_base ?? 0),
    CostoBase: Number(p.costo_base ?? 0),
    updated_at: p.updated_at ?? ahora(),
    deleted_at: p.deleted_at ?? null,
    version: Number(p.version ?? 1)
  };
}

export function productoDesdeCostoPayload(p: any): ProductoCosto {
  return {
    IDCosto: p.id,
    IDModelo: p.producto_id,
    Costo: Number(p.costo ?? 0),
    VigenteDesde: p.vigente_desde ?? ahora(),
    updated_at: p.updated_at ?? ahora(),
    deleted_at: p.deleted_at ?? null,
    version: Number(p.version ?? 1)
  };
}

export function tallaDesdePayload(p: any): Tallas {
  return {
    IDTalla: p.id,
    IDModelo: p.producto_id,
    Talla: Number(p.talla ?? 0),
    Stock: Number(p.stock ?? 0),
    updated_at: p.updated_at ?? ahora(),
    deleted_at: p.deleted_at ?? null,
    version: Number(p.version ?? 1)
  };
}

export function proveedorDesdePayload(p: any): Proveedor {
  return {
    IDProveedor: p.id,
    Nombre: p.nombre ?? '',
    Telefono: p.telefono ?? '',
    Direccion: p.direccion ?? '',
    Correo: p.correo ?? '',
    updated_at: p.updated_at ?? ahora(),
    deleted_at: p.deleted_at ?? null,
    version: Number(p.version ?? 1)
  };
}

export function materialDesdePayload(p: any): InventarioMPrima {
  return {
    IDItem: p.id,
    Nombre: p.nombre ?? '',
    Categoria: p.categoria ?? '',
    Precio: Number(p.precio ?? 0),
    Stock: Number(p.stock ?? 0),
    updated_at: p.updated_at ?? ahora(),
    deleted_at: p.deleted_at ?? null,
    version: Number(p.version ?? 1)
  };
}

export function ventaDesdePayload(p: any): Venta {
  return {
    IDVenta: p.id,
    IDCliente: p.cliente_id,
    Fecha: p.fecha ? new Date(p.fecha) : new Date(),
    Total: Number(p.total ?? 0),
    UsuarioID: p.usuario_id ?? undefined,
    Estado: p.estado === 'anulada' ? 'anulada' : 'activa',
    AnuladaEn: p.anulada_en ?? null,
    AnuladaPor: p.anulada_por ?? null,
    updated_at: p.updated_at ?? ahora(),
    deleted_at: p.deleted_at ?? null,
    version: Number(p.version ?? 1)
  };
}

export function detallesVentaDesdePayload(p: any): VentaDetalle[] {
  return (Array.isArray(p.detalles) ? p.detalles : []).map((d: any) => ({
    IDDetalle: d.id,
    IDVenta: p.id,
    IDTalla: d.talla_id,
    Cantidad: Number(d.cantidad ?? 0),
    PrecioUnitario: Number(d.precio_unitario ?? 0),
    ...(d.costo_unitario !== undefined && d.costo_unitario !== null
      ? { CostoUnitario: Number(d.costo_unitario) }
      : {})
  }));
}

export function compraDesdePayload(p: any): Compra {
  return {
    IDCompra: p.id,
    IDProveedor: p.proveedor_id,
    Fecha: p.fecha ? new Date(p.fecha) : new Date(),
    Total: Number(p.total ?? 0),
    UsuarioID: p.usuario_id ?? undefined,
    Estado: p.estado === 'anulada' ? 'anulada' : 'activa',
    AnuladaEn: p.anulada_en ?? null,
    AnuladaPor: p.anulada_por ?? null,
    updated_at: p.updated_at ?? ahora(),
    deleted_at: p.deleted_at ?? null,
    version: Number(p.version ?? 1)
  };
}

export function detallesCompraDesdePayload(p: any): CompraDetalle[] {
  return (Array.isArray(p.detalles) ? p.detalles : []).map((d: any) => ({
    IDDetalle: d.id,
    IDCompra: p.id,
    IDItem: d.materia_prima_id,
    Cantidad: Number(d.cantidad ?? 0),
    PrecioUnitario: Number(d.precio_unitario ?? 0)
  }));
}
