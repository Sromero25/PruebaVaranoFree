/**
 * adminView.ts
 * ----------------------------------------------------------------------------
 * Panel de administración (sólo se crea si la sesión es de administrador).
 *
 * Permite: crear usuarios / cambiar contraseñas / activar-desactivar; dar de
 * alta, corregir y eliminar proveedores y materiales (con su precio); y
 * corregir o eliminar modelos. Las correcciones de ventas y de existencias de
 * calzado se hacen desde las vistas de Ventas e Inventario.
 */

import { db } from '../db.js';
import { esAdmin, listarUsuarios, crearUsuario, cambiarPassword, cambiarEstadoUsuario } from '../auth.js';
import {
  crearProveedorDB, actualizarProveedorDB, eliminarProveedorDB,
  crearMaterialDB, actualizarMaterialDB, eliminarMaterialDB,
  actualizarProductoDB, eliminarProductoDB
} from '../servicios.js';
import {
  el, esc, notificar, mensajeDeError, formatearDinero, formatearFechaHora,
  obtenerOCrearVista, pedirCampos, confirmarAccion
} from '../herramientas.js';

let alCambiar: () => Promise<void> = async () => {};

function tarjeta(titulo: string, ent: string, cuerpoId: string, cabeceras: string[], nuevo: boolean): string {
  return `<section class="x-card">
    <div class="x-card-cab"><h3>${titulo}</h3>${nuevo ? `<button type="button" class="x-btn" data-ent="${ent}" data-accion="nuevo">+ Nuevo</button>` : ''}</div>
    <div class="x-tabla"><table><thead><tr>${cabeceras.map(c => `<th>${c}</th>`).join('')}<th></th></tr></thead>
    <tbody id="${cuerpoId}"></tbody></table></div></section>`;
}

export function montarAdminView(alCambiarDatos: () => Promise<void>): void {
  if (!esAdmin()) return;
  alCambiar = alCambiarDatos;

  // Enlace en el menú lateral
  const ref = document.querySelector('.nav-link');
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'nav-link';
  link.dataset.vista = 'admin';
  link.textContent = 'Administración';
  ref?.parentElement?.append(link);

  const vista = obtenerOCrearVista('admin');
  vista.innerHTML = `
    <header class="x-cabecera"><h2>Administración</h2><p>Usuarios, proveedores, materiales y modelos. Solo visible para administradores.</p></header>
    ${tarjeta('Usuarios', 'usuario', 'adm-usuarios', ['Usuario', 'Nombre', 'Rol', 'Estado'], true)}
    ${tarjeta('Proveedores', 'proveedor', 'adm-proveedores', ['Nombre', 'Teléfono', 'Dirección', 'Correo'], true)}
    ${tarjeta('Materiales y precios', 'material', 'adm-materiales', ['Material', 'Categoría', 'Precio', 'Existencia'], true)}
    ${tarjeta('Modelos de calzado', 'modelo', 'adm-modelos', ['Modelo', 'Precio base', 'Costo por par', 'Utilidad por par'], false)}
    <section class="x-card">
      <div class="x-card-cab"><h3>Historial de costos por modelo</h3></div>
      <div class="x-tabla"><table>
        <thead><tr><th>Modelo</th><th class="right">Costo por par</th><th>Vigente desde</th></tr></thead>
        <tbody id="adm-costos"></tbody>
      </table></div>
      <p class="x-nota">Cada cambio de costo queda registrado. Las ventas pasadas conservan el costo que tenían al momento de venderse.</p>
    </section>
    <p class="x-nota">Para dar de alta un modelo nuevo usa Inventario → Calzado. Las ventas se corrigen desde Ventas.</p>`;

  vista.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-accion]');
    if (b) void manejar(b);
  });
}

async function manejar(b: HTMLButtonElement): Promise<void> {
  const { ent, accion } = b.dataset;
  const id = b.dataset.id ?? '';
  if (accion !== 'nuevo' && !id) return;
  try {
    switch (`${ent}:${accion}`) {
      case 'usuario:nuevo': await nuevoUsuario(); break;
      case 'usuario:password': await nuevaPassword(id); break;
      case 'usuario:estado': {
        const activar = b.dataset.activo === '1';
        const ok = await confirmarAccion({
          titulo: activar ? 'Activar usuario' : 'Desactivar usuario',
          mensaje: `¿Estás seguro de ${activar ? 'activar' : 'desactivar'} este usuario?`,
          detalle: activar ? 'Podrá volver a iniciar sesión.' : 'Se cerrarán sus sesiones abiertas.',
          textoOk: activar ? 'Sí, activar' : 'Sí, desactivar',
          peligro: !activar
        });
        if (!ok) return;
        await cambiarEstadoUsuario(id, activar);
        notificar('Usuario actualizado.');
        break;
      }
      case 'proveedor:nuevo': await formProveedor(); break;
      case 'proveedor:editar': await formProveedor(id); break;
      case 'proveedor:borrar': {
        const ok = await confirmarAccion({
          titulo: 'Eliminar proveedor', mensaje: '¿Estás seguro de eliminar este proveedor?',
          detalle: 'Solo se puede eliminar si no tiene compras registradas.',
          textoOk: 'Sí, eliminar', peligro: true
        });
        if (!ok) return;
        await eliminarProveedorDB(id); notificar('Proveedor eliminado.');
        break;
      }
      case 'material:nuevo': await formMaterial(); break;
      case 'material:editar': await formMaterial(id); break;
      case 'material:borrar': {
        const ok = await confirmarAccion({
          titulo: 'Eliminar material', mensaje: '¿Estás seguro de eliminar este material?',
          detalle: 'Solo se puede eliminar si no tiene compras registradas.',
          textoOk: 'Sí, eliminar', peligro: true
        });
        if (!ok) return;
        await eliminarMaterialDB(id); notificar('Material eliminado.');
        break;
      }
      case 'modelo:editar': await formModelo(id); break;
      case 'modelo:borrar': {
        const ok = await confirmarAccion({
          titulo: 'Eliminar modelo', mensaje: '¿Estás seguro de eliminar este modelo y todas sus tallas?',
          detalle: 'Solo se puede eliminar si no tiene ventas registradas.',
          textoOk: 'Sí, eliminar', peligro: true
        });
        if (!ok) return;
        await eliminarProductoDB(id); notificar('Modelo eliminado.');
        break;
      }
      default: return;
    }
    await renderAdminView();
    await alCambiar();
  } catch (err) {
    notificar(mensajeDeError(err), true);
  }
}

// ---------------------------------------------------------------- formularios

async function nuevoUsuario(): Promise<void> {
  const r = await pedirCampos('Nuevo usuario', [
    { nombre: 'usuario', etiqueta: 'Usuario (3-30: letras, números . _ -)', maxLength: 30 },
    { nombre: 'nombre', etiqueta: 'Nombre', maxLength: 60 },
    { nombre: 'password', etiqueta: 'Contraseña (mínimo 8 caracteres)', tipo: 'password', maxLength: 128 },
    { nombre: 'rol', etiqueta: 'Rol', tipo: 'select', valor: 'normal',
      opciones: [{ valor: 'normal', texto: 'Usuario normal' }, { valor: 'admin', texto: 'Administrador' }] }
  ], 'Crear usuario');
  if (!r) return;
  const rol = r.rol === 'admin' ? 'admin' : 'normal';
  const ok = await confirmarAccion({
    titulo: 'Confirmar nuevo usuario',
    mensaje: '¿Estás seguro de crear este usuario?',
    detalle: `Usuario: ${r.usuario}\nNombre: ${r.nombre}\nRol: ${rol === 'admin' ? 'Administrador' : 'Usuario normal'}`,
    textoOk: 'Sí, crear usuario'
  });
  if (!ok) return;
  await crearUsuario({
    usuario: r.usuario ?? '', nombre: r.nombre ?? '', password: r.password ?? '', rol
  });
  notificar('Usuario creado.');
}

async function nuevaPassword(id: string): Promise<void> {
  const r = await pedirCampos('Cambiar contraseña', [
    { nombre: 'password', etiqueta: 'Nueva contraseña (mínimo 8 caracteres)', tipo: 'password', maxLength: 128 }
  ]);
  if (!r) return;
  const ok = await confirmarAccion({
    titulo: 'Confirmar cambio de contraseña',
    mensaje: '¿Estás seguro de cambiar la contraseña? Se cerrarán las sesiones de ese usuario.',
    textoOk: 'Sí, cambiar contraseña',
    peligro: true
  });
  if (!ok) return;
  await cambiarPassword(id, r.password ?? '');
  notificar('Contraseña actualizada.');
}

async function formProveedor(id?: string): Promise<void> {
  const p = id ? await db.proveedores.get(id) : undefined;
  const r = await pedirCampos(id ? 'Corregir proveedor' : 'Nuevo proveedor', [
    { nombre: 'Nombre', etiqueta: 'Nombre', valor: p?.Nombre ?? '', maxLength: 80 },
    { nombre: 'Telefono', etiqueta: 'Teléfono', tipo: 'tel', valor: p?.Telefono ?? '', requerido: false, maxLength: 25 },
    { nombre: 'Direccion', etiqueta: 'Dirección', valor: p?.Direccion ?? '', requerido: false, maxLength: 120 },
    { nombre: 'Correo', etiqueta: 'Correo', tipo: 'email', valor: p?.Correo ?? '', requerido: false, maxLength: 80 }
  ]);
  if (!r) return;
  const datos = { Nombre: r.Nombre ?? '', Telefono: r.Telefono ?? '', Direccion: r.Direccion ?? '', Correo: r.Correo ?? '' };
  const ok = await confirmarAccion({
    titulo: id ? 'Confirmar corrección de proveedor' : 'Confirmar nuevo proveedor',
    mensaje: '¿Estás seguro de guardar este proveedor?',
    detalle: `Nombre: ${datos.Nombre}\nTeléfono: ${datos.Telefono || '(sin teléfono)'}\nDirección: ${datos.Direccion || '(sin dirección)'}\nCorreo: ${datos.Correo || '(sin correo)'}`,
    textoOk: 'Sí, guardar proveedor'
  });
  if (!ok) return;
  if (id) await actualizarProveedorDB(id, datos); else await crearProveedorDB(datos);
  notificar('Proveedor guardado.');
}

async function formMaterial(id?: string): Promise<void> {
  const m = id ? await db.materiaPrima.get(id) : undefined;
  const r = await pedirCampos(id ? 'Corregir material' : 'Nuevo material', [
    { nombre: 'Nombre', etiqueta: 'Nombre', valor: m?.Nombre ?? '', maxLength: 80 },
    { nombre: 'Categoria', etiqueta: 'Categoría', valor: m?.Categoria ?? '', requerido: false, maxLength: 60 },
    { nombre: 'Precio', etiqueta: 'Precio por unidad', tipo: 'number', valor: m?.Precio ?? '', min: 0, step: '0.01' },
    { nombre: 'Stock', etiqueta: 'Existencia', tipo: 'number', valor: m?.Stock ?? 0, min: 0, step: 'any' }
  ]);
  if (!r) return;
  const datos = { Nombre: r.Nombre ?? '', Categoria: r.Categoria ?? '', Precio: Number(r.Precio), Stock: Number(r.Stock) };
  const ok = await confirmarAccion({
    titulo: id ? 'Confirmar corrección de material' : 'Confirmar nuevo material',
    mensaje: '¿Estás seguro de guardar este material?',
    detalle: `Material: ${datos.Nombre}\nCategoría: ${datos.Categoria || '(sin categoría)'}\nPrecio: ${formatearDinero(datos.Precio)}\nExistencia: ${datos.Stock}`,
    textoOk: 'Sí, guardar material'
  });
  if (!ok) return;
  if (id) await actualizarMaterialDB(id, datos); else await crearMaterialDB(datos);
  notificar('Material guardado.');
}

async function formModelo(id: string): Promise<void> {
  const p = await db.productos.get(id);
  if (!p) throw new Error('El modelo no existe.');
  const r = await pedirCampos('Corregir modelo', [
    { nombre: 'Modelo', etiqueta: 'Modelo', valor: p.Modelo, maxLength: 40 },
    { nombre: 'PrecioBase', etiqueta: 'Precio base', tipo: 'number', valor: p.PrecioBase, min: 0, step: '0.01' },
    { nombre: 'CostoBase', etiqueta: 'Costo por par', tipo: 'number', valor: p.CostoBase ?? 0, min: 0, step: '0.01' }
  ]);
  if (!r) return;
  const precio = Number(r.PrecioBase);
  const costo = Number(r.CostoBase);
  const ok = await confirmarAccion({
    titulo: 'Confirmar corrección de modelo',
    mensaje: '¿Estás seguro de guardar estos cambios? El nuevo costo aplicará a las ventas futuras.',
    detalle: `Modelo: ${p.Modelo} → ${r.Modelo}\nPrecio base: ${formatearDinero(p.PrecioBase)} → ${formatearDinero(precio)}\nCosto por par: ${formatearDinero(p.CostoBase ?? 0)} → ${formatearDinero(costo)}\nUtilidad por par: ${formatearDinero(precio - costo)}`,
    textoOk: 'Sí, guardar modelo'
  });
  if (!ok) return;
  await actualizarProductoDB(id, { Modelo: r.Modelo ?? '', PrecioBase: precio, CostoBase: costo });
  notificar('Modelo actualizado.');
}

// ---------------------------------------------------------------- render

const vacio = (cols: number): string => `<tr><td colspan="${cols}" class="empty">Sin registros.</td></tr>`;
const boton = (ent: string, accion: string, id: string | undefined, texto: string, extra = '', peligro = false): string =>
  `<button class="x-btn-mini${peligro ? ' x-peligro' : ''}" data-ent="${ent}" data-accion="${accion}" data-id="${id ?? ''}" ${extra}>${texto}</button>`;

export async function renderAdminView(): Promise<void> {
  if (!esAdmin() || !el('adm-usuarios')) return;
  const [usuarios, proveedores, materiales, modelos, costos] = await Promise.all([
    listarUsuarios(),
    db.proveedores.filter(p => !p.deleted_at).toArray(),
    db.materiaPrima.filter(m => !m.deleted_at).toArray(),
    db.productos.filter(p => !p.deleted_at).toArray(),
    db.productoCostos.toArray()
  ]);

  el('adm-usuarios')!.innerHTML = usuarios.length === 0 ? vacio(5) : usuarios.map(u => `<tr>
    <td>${esc(u.Usuario)}</td><td>${esc(u.Nombre)}</td><td>${u.Rol === 'admin' ? 'Administrador' : 'Usuario'}</td>
    <td>${u.Activo ? '<span class="badge">Activo</span>' : '<span class="badge badge-peligro">Desactivado</span>'}</td>
    <td class="x-acciones-fila">${boton('usuario', 'password', u.IDUsuario, 'Contraseña')}
      ${boton('usuario', 'estado', u.IDUsuario, u.Activo ? 'Desactivar' : 'Activar', `data-activo="${u.Activo ? 0 : 1}"`, !!u.Activo)}</td></tr>`).join('');

  el('adm-proveedores')!.innerHTML = proveedores.length === 0 ? vacio(5) : proveedores.map(p => `<tr>
    <td>${esc(p.Nombre)}</td><td>${esc(p.Telefono)}</td><td>${esc(p.Direccion)}</td><td>${esc(p.Correo ?? '')}</td>
    <td class="x-acciones-fila">${boton('proveedor', 'editar', p.IDProveedor, 'Corregir')}${boton('proveedor', 'borrar', p.IDProveedor, 'Eliminar', '', true)}</td></tr>`).join('');

  el('adm-materiales')!.innerHTML = materiales.length === 0 ? vacio(5) : materiales.map(m => `<tr>
    <td>${esc(m.Nombre)}</td><td>${esc(m.Categoria)}</td>
    <td class="right">${m.Precio > 0 ? formatearDinero(m.Precio) : '<span class="badge badge-alerta">Sin precio</span>'}</td><td class="right">${m.Stock}</td>
    <td class="x-acciones-fila">${boton('material', 'editar', m.IDItem, 'Corregir')}${boton('material', 'borrar', m.IDItem, 'Eliminar', '', true)}</td></tr>`).join('');

  el('adm-modelos')!.innerHTML = modelos.length === 0 ? vacio(5) : modelos.map(p => {
    const costo = p.CostoBase ?? 0;
    return `<tr>
      <td>${esc(p.Modelo)}</td><td class="right">${formatearDinero(p.PrecioBase)}</td>
      <td class="right">${costo > 0 ? formatearDinero(costo) : '<span class="badge badge-alerta">Sin costo</span>'}</td>
      <td class="right">${formatearDinero(p.PrecioBase - costo)}</td>
      <td class="x-acciones-fila">${boton('modelo', 'editar', p.IDModelo, 'Corregir')}${boton('modelo', 'borrar', p.IDModelo, 'Eliminar', '', true)}</td></tr>`;
  }).join('');

  const nombresModelo = new Map(modelos.map(p => [p.IDModelo as string, p.Modelo]));
  const historial = [...costos]
    .sort((a, b) => new Date(b.VigenteDesde).getTime() - new Date(a.VigenteDesde).getTime())
    .slice(0, 100);
  el('adm-costos')!.innerHTML = historial.length === 0
    ? vacio(3)
    : historial.map(c => `<tr>
        <td>${esc(nombresModelo.get(c.IDModelo) ?? `Modelo #${c.IDModelo}`)}</td>
        <td class="right">${formatearDinero(c.Costo)}</td>
        <td>${formatearFechaHora(c.VigenteDesde)}</td>
      </tr>`).join('');
}