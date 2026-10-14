import { Dexie, type Table } from 'dexie';

// 1. Interfaces
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

export interface Venta {
    IDVenta?: number;
    IDCliente: number;
    IDTalla: number;
    Cantidad: number;
    PrecioUnitario: number;
    Fecha: Date;
}

export interface Proveedor {
    IDProveedor?: number;
    Nombre: string;
    Telefono: string;
    Direccion: string;
    Correo?: string;
}

export interface Compras {
    IDCompra?: number;
    IDProveedor: number;
    IDItem: number;
    Cantidad: number;
    Costo: number;
    Fecha: Date;
}

export interface InventarioMPrima {
    IDItem?: number;
    Nombre: string;
    Categoria: string;
    Stock: number;
}

// 2. Base de Datos
export class CalzadoDB extends Dexie {
    productos!: Table<Producto, number>;
    tallas!: Table<Tallas, number>;
    clientes!: Table<Cliente, number>;
    ventas!: Table<Venta, number>;
    proveedores!: Table<Proveedor, number>;
    compras!: Table<Compras, number>;
    materiaPrima!: Table<InventarioMPrima, number>;

    constructor() {
        super('TallerCalzadoDB');

        this.version(1).stores({
            productos: '++IDModelo, Modelo',
            tallas: '++IDTalla, IDModelo, Talla',
            clientes: '++IDCliente, Nombre, Apellido',
            ventas: '++IDVenta, IDCliente, IDTalla, Fecha',
            proveedores: '++IDProveedor, Nombre',
            compras: '++IDCompra, IDProveedor, IDItem, Fecha',
            materiaPrima: '++IDItem, Categoria'
        });
    }
}

export const db = new CalzadoDB();