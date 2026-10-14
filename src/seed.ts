import { db } from './db.js';

export async function cargarDatosIniciales() {
    const conteo = await db.productos.count();

    // Si la base de datos ya tiene registros, no duplicamos
    if (conteo > 0) return;

    console.log('Sembrando datos iniciales en la base de datos...');

    await db.productos.bulkAdd([
        { IDModelo: 1, Modelo: "801", PrecioBase: 350 },
        { IDModelo: 2, Modelo: "500", PrecioBase: 390 },
        { IDModelo: 3, Modelo: "711", PrecioBase: 300 }
    ]);

    await db.tallas.bulkAdd([
        { IDTalla: 101, IDModelo: 1, Talla: 26, Stock: 12 },
        { IDTalla: 102, IDModelo: 1, Talla: 27, Stock: 18 },
        { IDTalla: 103, IDModelo: 1, Talla: 28, Stock: 20 },
        { IDTalla: 201, IDModelo: 2, Talla: 22, Stock: 10 }
    ]);

    await db.clientes.bulkAdd([
        { IDCliente: 1, Nombre: "Pablo", Apellido: "Sánchez", Telefono: "442-223-223" },
        { IDCliente: 2, Nombre: "Caja", Apellido: "Mostrador" }
    ]);

    await db.proveedores.bulkAdd([
        { IDProveedor: 1, Nombre: "Distribuidora del Bajío", Telefono: "477-111-2233", Direccion: "León, Guanajuato" }
    ]);

    await db.materiaPrima.bulkAdd([
        { IDItem: 101, Nombre: "Piel sintética", Categoria: "Material exterior", Stock: 120 },
        { IDItem: 102, Nombre: "Suela de hule", Categoria: "Suela", Stock: 85 }
    ]);

    console.log('Catálogo inicial cargado con éxito.');
}