export class CartConflictError extends Error {
  constructor(currentVersion) {
    super('CART_VERSION_CONFLICT');
    this.code = 'CART_VERSION_CONFLICT';
    this.currentVersion = currentVersion;
  }
}

export class CartError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}
