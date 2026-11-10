import { db } from './db.js';

const BACKEND_URL = 'http://localhost:3000/api';

export async function sincronizarConBackend(): Promise<void> {
  try {
    console.log('Iniciando sincronización con el servidor central...');

    // 1. Obtener los registros locales de Dexie
    const ventasLocales = await db.ventas.toArray();
    const comprasLocales = await db.compras.toArray();

    // 2. Preparar el paquete con fallbacks para evitar errores de propiedades inexistentes
    const paqueteSync = {
      ventas: ventasLocales.map((v: any) => ({
        id: v.IDVenta || v.id,
        cliente_id: v.IDCliente || v.cliente_id,
        fecha: v.Fecha ? new Date(v.Fecha).toISOString() : new Date().toISOString(),
        total: Number(v.Total ?? ((v.Cantidad || 1) * (v.PrecioUnitario || 0))),
        detalles: [
          {
            id: crypto.randomUUID(),
            talla_id: v.IDTalla || v.talla_id || '',
            cantidad: Number(v.Cantidad || 1),
            precio_unitario: Number(v.PrecioUnitario || v.Total || 0)
          }
        ]
      })),
      compras: comprasLocales.map((c: any) => ({
        id: c.IDCompra || c.id,
        proveedor_id: c.IDProveedor || c.proveedor_id,
        fecha: c.Fecha ? new Date(c.Fecha).toISOString() : new Date().toISOString(),
        total: Number(c.Total ?? c.Costo ?? 0),
        detalles: [
          {
            id: crypto.randomUUID(),
            materia_prima_id: c.IDItem || c.materia_prima_id || '',
            cantidad: Number(c.Cantidad || 1),
            precio_unitario: Number((c.Costo || c.Total || 0) / (c.Cantidad || 1))
          }
        ]
      }))
    };

    // 3. Enviar al endpoint de sincronización
    const respuesta = await fetch(`${BACKEND_URL}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(paqueteSync)
    });

    if (!respuesta.ok) {
      throw new Error(`Error en el servidor: ${respuesta.statusText}`);
    }

    const resultado = await respuesta.json();
    console.log('Sincronización exitosa:', resultado.mensaje);
    console.log('Catálogos actualizados desde MySQL:', resultado.catalogos);

  } catch (error) {
    console.warn('No se pudo conectar al servidor central (modo offline activo):', error);
  }
}