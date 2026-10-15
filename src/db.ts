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
  IDModelo?: number;
  Modelo: string;
  PrecioBase: number;
}

export interface Tallas {
  IDTalla?: number;
  IDModelo: number;
  Talla: number;
  Stock: number;
}

export interface Cliente {
  IDCliente?: number;
  Nombre: string;
  Apellido: string;
  Telefono?: string;
  Direccion?: string;
}

/** Cabecera de venta. El detalle (tallas, cantidades, precios) está en `VentaDetalle`. */
export interface Venta {
  IDVenta?: number;
  IDCliente: number;
  Fecha: Date;
  Total: number;
}

export interface VentaDetalle {
  IDDetalle?: number;
  IDVenta: number;
  IDTalla: number;
  Cantidad: number;
  PrecioUnitario: number;
}

export interface Proveedor {
  IDProveedor?: number;
  Nombre: string;
  Telefono: string;
  Direccion: string;
  Correo?: string;
}

/** Cabecera de compra. */
export interface Compra {
  IDCompra?: number;
  IDProveedor: number;
  Fecha: Date;
  Total: number;
}

/** Línea de compra: guarda el precio que tenía el material al momento de comprar. */
export interface CompraDetalle {
  IDDetalle?: number;
  IDCompra: number;
  IDItem: number;
  Cantidad: number;
  PrecioUnitario: number;
}

export interface InventarioMPrima {
  IDItem?: number;
  Nombre: string;
  Categoria: string;
  /** Precio por unidad. Lo define el administrador. */
  Precio: number;
  Stock: number;
}

export interface Usuario {
  IDUsuario?: number;
  /** Nombre de acceso, siempre en minúsculas y único. */
  Usuario: string;
  Nombre: string;
  Rol: Rol;
  /** Sal aleatoria (hex) y hash PBKDF2 de la contraseña. Nunca se guarda la contraseña. */
  Sal: string;
  Hash: string;
  /** 1 = activo, 0 = desactivado. */
  Activo: 0 | 1;
}

/** Sesión guardada: sólo se almacena el hash del token, no el token. */
export interface Sesion {
  IDSesion?: number;
  TokenHash: string;
  IDUsuario: number;
  /** Marca de tiempo (ms) en que expira. */
  Expira: number;
}

export class CalzadoDB extends Dexie {
  productos!: Table<Producto, number>;
  tallas!: Table<Tallas, number>;
  clientes!: Table<Cliente, number>;
  ventas!: Table<Venta, number>;
  ventaDetalle!: Table<VentaDetalle, number>;
  proveedores!: Table<Proveedor, number>;
  compras!: Table<Compra, number>;
  compraDetalle!: Table<CompraDetalle, number>;
  materiaPrima!: Table<InventarioMPrima, number>;
  usuarios!: Table<Usuario, number>;
  sesiones!: Table<Sesion, number>;

  constructor() {
    super('TallerCalzadoDB');

    // Esquema original (necesario para poder migrar).
    this.version(1).stores({
      productos: '++IDModelo, Modelo',
      tallas: '++IDTalla, IDModelo, Talla',
      clientes: '++IDCliente, Nombre, Apellido',
      ventas: '++IDVenta, IDCliente, IDTalla, Fecha',
      proveedores: '++IDProveedor, Nombre',
      compras: '++IDCompra, IDProveedor, IDItem, Fecha',
      materiaPrima: '++IDItem, Categoria'
    });

    this.version(2)
      .stores({
        productos: '++IDModelo, Modelo',
        tallas: '++IDTalla, IDModelo, Talla, [IDModelo+Talla]',
        clientes: '++IDCliente, Nombre, Apellido',
        ventas: '++IDVenta, IDCliente, Fecha',
        ventaDetalle: '++IDDetalle, IDVenta, IDTalla',
        proveedores: '++IDProveedor, Nombre',
        compras: '++IDCompra, IDProveedor, Fecha',
        compraDetalle: '++IDDetalle, IDCompra, IDItem',
        materiaPrima: '++IDItem, Categoria',
        usuarios: '++IDUsuario, &Usuario',
        sesiones: '++IDSesion, &TokenHash, IDUsuario, Expira'
      })
      .upgrade(migrarV1aV2);
  }
}

/** Convierte ventas/compras de una sola línea (v1) al formato cabecera + detalle (v2). */
async function migrarV1aV2(tx: Transaction): Promise<void> {
  // --- Ventas ---
  const ventasViejas = await tx.table('ventas').toArray();
  for (const v of ventasViejas) {
    await tx.table('ventaDetalle').add({
      IDVenta: v.IDVenta,
      IDTalla: v.IDTalla,
      Cantidad: v.Cantidad,
      PrecioUnitario: v.PrecioUnitario
    });
    await tx.table('ventas').put({
      IDVenta: v.IDVenta,
      IDCliente: v.IDCliente,
      Fecha: v.Fecha,
      Total: v.Cantidad * v.PrecioUnitario
    });
  }

  // --- Compras ---
  const comprasViejas = (await tx.table('compras').toArray()).sort(
    (a, b) => new Date(a.Fecha).getTime() - new Date(b.Fecha).getTime()
  );
  const ultimoPrecio = new Map<number, number>();
  for (const c of comprasViejas) {
    const unitario = c.Cantidad > 0 ? c.Costo / c.Cantidad : 0;
    await tx.table('compraDetalle').add({
      IDCompra: c.IDCompra,
      IDItem: c.IDItem,
      Cantidad: c.Cantidad,
      PrecioUnitario: unitario
    });
    await tx.table('compras').put({
      IDCompra: c.IDCompra,
      IDProveedor: c.IDProveedor,
      Fecha: c.Fecha,
      Total: c.Costo
    });
    ultimoPrecio.set(c.IDItem, unitario);
  }

  // --- Materia prima: precio inicial = último precio pagado (o 0 si nunca se compró) ---
  await tx.table('materiaPrima').toCollection().modify((m: InventarioMPrima) => {
    m.Precio = ultimoPrecio.get(m.IDItem as number) ?? 0;
  });
}

export const db = new CalzadoDB();