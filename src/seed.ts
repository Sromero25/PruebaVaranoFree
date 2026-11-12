/**
 * seed.ts
 * ----------------------------------------------------------------------------
 * Datos de ejemplo para una instalación nueva (base local vacía).
 * Se encolan en `outbox` para que también lleguen al servidor cuando el
 * usuario inicie sesión.
 */

import { db } from './db.js';
import { v4 as uuidv4 } from 'uuid';
import {
  encolarCliente, encolarMaterial, encolarProducto, encolarProveedor, encolarTalla
} from './sync/outbox.js';

const ahora = (): string => new Date().toISOString();

export async function cargarDatosIniciales(): Promise<void> {
  if ((await db.productos.count()) > 0) return;

  console.log('Sembrando datos iniciales en la base de datos...');

  const p1 = { IDModelo: uuidv4(), Modelo: '801', PrecioBase: 350, CostoBase: 210, updated_at: ahora(), version: 1 };
  const p2 = { IDModelo: uuidv4(), Modelo: '500', PrecioBase: 390, CostoBase: 240, updated_at: ahora(), version: 1 };
  const p3 = { IDModelo: uuidv4(), Modelo: '711', PrecioBase: 300, CostoBase: 185, updated_at: ahora(), version: 1 };
  const productos = [p1, p2, p3];

  const tallas = [
    { IDTalla: uuidv4(), IDModelo: p1.IDModelo, Talla: 26, Stock: 12, updated_at: ahora(), version: 1 },
    { IDTalla: uuidv4(), IDModelo: p1.IDModelo, Talla: 27, Stock: 18, updated_at: ahora(), version: 1 },
    { IDTalla: uuidv4(), IDModelo: p1.IDModelo, Talla: 28, Stock: 20, updated_at: ahora(), version: 1 },
    { IDTalla: uuidv4(), IDModelo: p2.IDModelo, Talla: 22, Stock: 10, updated_at: ahora(), version: 1 }
  ];

  const clientes = [
    { IDCliente: uuidv4(), Nombre: 'Pablo', Apellido: 'Sánchez', Telefono: '442-223-223', updated_at: ahora(), version: 1 },
    { IDCliente: uuidv4(), Nombre: 'Caja', Apellido: 'Mostrador', Telefono: '', updated_at: ahora(), version: 1 }
  ];

  const proveedores = [
    { IDProveedor: uuidv4(), Nombre: 'Distribuidora del Bajío', Telefono: '477-111-2233', Direccion: 'León, Guanajuato', Correo: '', updated_at: ahora(), version: 1 }
  ];

  const materiales = [
    { IDItem: uuidv4(), Nombre: 'Piel sintética', Categoria: 'Material exterior', Precio: 85, Stock: 120, updated_at: ahora(), version: 1 },
    { IDItem: uuidv4(), Nombre: 'Suela de hule', Categoria: 'Suela', Precio: 40, Stock: 85, updated_at: ahora(), version: 1 }
  ];

  await db.transaction(
    'rw',
    [db.productos, db.tallas, db.clientes, db.proveedores, db.materiaPrima, db.outbox],
    async () => {
      await db.productos.bulkAdd(productos);
      await db.tallas.bulkAdd(tallas);
      await db.clientes.bulkAdd(clientes);
      await db.proveedores.bulkAdd(proveedores);
      await db.materiaPrima.bulkAdd(materiales);

      for (const p of productos) await encolarProducto(p);
      for (const t of tallas) await encolarTalla(t);
      for (const c of clientes) await encolarCliente(c);
      for (const p of proveedores) await encolarProveedor(p);
      for (const m of materiales) await encolarMaterial(m);
    }
  );

  console.log('Catálogo inicial cargado con éxito.');
}
