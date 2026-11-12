/** Error de negocio que se devuelve al cliente como un cambio rechazado, no como 500. */
export class ConflictoError extends Error {
  readonly estado = 'conflicto' as const;
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ConflictoError';
  }
}

export class ValidacionError extends Error {
  readonly estado = 'error' as const;
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ValidacionError';
  }
}
