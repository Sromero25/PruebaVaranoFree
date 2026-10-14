import { db } from './db.js';

// REGISTRAR VENTA Y DESCONTAR STOCK DE ZAPATOS
export async function registrarVentaDB(
    IDCliente: number,
    IDTalla: number,
    Cantidad: number,
    PrecioUnitario: number
): Promise<void> {
    try {
        await db.transaction('rw', db.tallas, db.ventas, async () => {
            const variante = await db.tallas.get(IDTalla);

            if (!variante) {
                throw new Error(`La talla con ID ${IDTalla} no existe.`);
            }

            if (variante.Stock < Cantidad) {
                throw new Error(`Stock insuficiente. Solo quedan ${variante.Stock} pares de la talla ${variante.Talla}.`);
            }

            // Descontar inventario
            await db.tallas.update(IDTalla, {
                Stock: variante.Stock - Cantidad
            });

            // Guardar venta
            const idVentaGenerado = await db.ventas.add({
                IDCliente,
                IDTalla,
                Cantidad,
                PrecioUnitario,
                Fecha: new Date()
            });

            console.log(`Venta #${idVentaGenerado} guardada con éxito en la base de datos.`);
        });
    } catch (error) {
        console.error('Error al procesar la venta:', error);
    }
}

// REGISTRAR COMPRA DE MATERIAL Y SUMAR STOCK AL INSUMO
export async function registrarCompraDB(
    IDProveedor: number,
    IDItem: number,
    Cantidad: number,
    Costo: number
): Promise<void> {
    try {
        await db.transaction('rw', db.materiaPrima, db.compras, async () => {
            const material = await db.materiaPrima.get(IDItem);

            if (!material) {
                throw new Error(`El insumo con ID ${IDItem} no existe.`);
            }

            // Sumar al almacén
            await db.materiaPrima.update(IDItem, {
                Stock: material.Stock + Cantidad
            });

            // Guardar compra
            const idCompraGenerado = await db.compras.add({
                IDProveedor,
                IDItem,
                Cantidad,
                Costo,
                Fecha: new Date()
            });

            console.log(`Compra #${idCompraGenerado} guardada con éxito en la base de datos.`);
        });
    } catch (error) {
        console.error('Error al procesar la compra:', error);
    }
}

// CALCULAR BALANCE GENERAL
export async function obtenerBalanceDB() {
    const ventas = await db.ventas.toArray();
    const compras = await db.compras.toArray();

    const totalIngresos = ventas.reduce((acc, v) => acc + (v.Cantidad * v.PrecioUnitario), 0);
    const totalGastos = compras.reduce((acc, c) => acc + c.Costo, 0);

    return {
        totalIngresos,
        totalGastos,
        utilidadNeta: totalIngresos - totalGastos
    };
}