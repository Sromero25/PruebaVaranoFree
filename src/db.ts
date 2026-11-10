/**
 * db.ts
 * ----------------------------------------------------------------------------
 * Definición de la base de datos local (IndexedDB mediante Dexie).
 *
 * Versión 2 (cambios respecto a la 1):
 *  - Ventas: ahora son una cabecera (`ventas`) + líneas (`ventaDetalle`), así una
 *    venta puede incluir muchas tallas (p. ej. de la 18 a la 30).
 *  - Compras: cabecera (`compras`) + líneas (`compraDetalle`). El costo sale del
 *    precio guardado en cada material.
 *  - Materia prima: nuevo campo `Precio`.
 *  - Nuevas tablas `usuarios` y `sesiones` para el login.
 *  La migración convierte automáticamente el historial de la versión 1.
 */

import { Dexie, type Table, type Transaction } from 'dexie';

export type Rol = 'admin' | 'normal';

export interface Producto {
  IDModelo: string;
  Modelo: string;
  PrecioBase: number;
}

export interface Tallas {
  IDTalla: string;
  IDModelo: string;
  Talla: number;
  Stock: number;
}

export interface Cliente {
  IDCliente: string;
  Nombre: string;
  Apellido: string;
  Telefono?: string;
  Direccion?: string;
}

/** Cabecera de venta. El detalle (tallas, cantidades, precios) está en `VentaDetalle`. */
export interface Venta {
  IDVenta: string;
  IDCliente: string;
  Fecha: Date;
  Total: number;
}

export interface VentaDetalle {
  IDDetalle: string;
  IDVenta: string;
  IDTalla: string;
  Cantidad: number;
  PrecioUnitario: number;
}

export interface Proveedor {
  IDProveedor: string;
  Nombre: string;
  Telefono: string;
  Direccion: string;
  Correo?: string;
}

/** Cabecera de compra. */
export interface Compra {
  IDCompra: string;
  IDProveedor: string;
  Fecha: Date;
  Total: number;
}

/** Línea de compra: guarda el precio que tenía el material al momento de comprar. */
export interface CompraDetalle {
  IDDetalle: string;
  IDCompra: string;
  IDItem: string;
  Cantidad: number;
  PrecioUnitario: number;
}

export interface InventarioMPrima {
  IDItem: string;
  Nombre: string;
  Categoria: string;
  Precio: number;
  Stock: number;
}

export interface Usuario {
  IDUsuario: string;
  Usuario: string;
  Nombre: string;
  Rol: Rol;
  Sal: string;
  Hash: string;
  Activo: 0 | 1;
}

/** Sesión guardada: sólo se almacena el hash del token, no el token. */
export interface Sesion {
  IDSesion: string;
  TokenHash: string;
  IDUsuario: string;
  Expira: number;
}

export class CalzadoDB extends Dexie {
 productos!: Table<Producto, string>;
  tallas!: Table<Tallas, string>;
  clientes!: Table<Cliente, string>;
  ventas!: Table<Venta, string>;
  ventaDetalle!: Table<VentaDetalle, string>;
  proveedores!: Table<Proveedor, string>;
  compras!: Table<Compra, string>;
  compraDetalle!: Table<CompraDetalle, string>;
  materiaPrima!: Table<InventarioMPrima, string>;
  usuarios!: Table<Usuario, string>;
  sesiones!: Table<Sesion, string>;

  constructor() {
    super('TallerCalzadoDB');

    // Esquema original (necesario para poder migrar).
    this.version(1).stores({
      productos: 'IDModelo, Modelo',
      tallas: 'IDTalla, IDModelo, Talla, [IDModelo+Talla]',
      clientes: 'IDCliente, Nombre, Apellido',
      ventas: 'IDVenta, IDCliente, Fecha',
      ventaDetalle: 'IDDetalle, IDVenta, IDTalla',
      proveedores: 'IDProveedor, Nombre',
      compras: 'IDCompra, IDProveedor, Fecha',
      compraDetalle: 'IDDetalle, IDCompra, IDItem',
      materiaPrima: 'IDItem, Categoria',
      usuarios: 'IDUsuario, &Usuario',
      sesiones: 'IDSesion, &TokenHash, IDUsuario, Expira'
    });
  }
}


export const db = new CalzadoDB();