/**
 * navegacion.ts
 * ----------------------------------------------------------------------------
 * Control de la navegación entre vistas (secciones `.vista`) y del menú
 * hamburguesa en móvil.
 *
 * Convenciones del HTML:
 *  - Cada botón del menú: `.nav-link` con `data-vista="nombre"`.
 *  - Cada sección: `.vista` con id `vista-nombre`.
 *  - Botones de atajo: cualquier elemento con `data-ir="nombre"`.
 */

export function inicializarNavegacion(): void {
  const links = document.querySelectorAll<HTMLButtonElement>('.nav-link');
  const vistas = document.querySelectorAll<HTMLElement>('.vista');
  const app = document.getElementById('app');
  const btnMenu = document.getElementById('btn-menu');
  const overlay = document.getElementById('overlay');

  /** Muestra la vista indicada, marca su enlace como activo y cierra el menú móvil. */
  function cambiarVista(nombreVista: string): void {
    vistas.forEach(v => v.classList.remove('activa'));
    links.forEach(l => l.removeAttribute('aria-current'));

    const vistaTarget = document.getElementById(`vista-${nombreVista}`);
    const linkTarget = document.querySelector(`.nav-link[data-vista="${nombreVista}"]`);

    vistaTarget?.classList.add('activa');
    linkTarget?.setAttribute('aria-current', 'page');

    app?.classList.remove('menu-abierto');
  }

  links.forEach(link => {
    link.addEventListener('click', () => {
      const vista = link.getAttribute('data-vista');
      if (vista) cambiarVista(vista);
    });
  });

  // Botones de atajo rápido (ej. "+ Nueva venta" en Inicio)
  document.querySelectorAll<HTMLButtonElement>('[data-ir]').forEach(btn => {
    btn.addEventListener('click', () => {
      const destino = btn.getAttribute('data-ir');
      if (destino) cambiarVista(destino);
    });
  });

  // Menú hamburguesa (móvil)
  btnMenu?.addEventListener('click', () => app?.classList.toggle('menu-abierto'));
  overlay?.addEventListener('click', () => app?.classList.remove('menu-abierto'));
}