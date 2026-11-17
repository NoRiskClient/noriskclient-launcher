const objectCtor = Object as typeof Object & {
  hasOwn?: (obj: object, key: PropertyKey) => boolean;
};

if (!objectCtor.hasOwn) {
  Object.defineProperty(Object, "hasOwn", {
    value: (obj: object, key: PropertyKey) =>
      Object.prototype.hasOwnProperty.call(obj, key),
    writable: true,
    configurable: true,
  });
}

const arrayProto = Array.prototype as unknown[] & {
  at?: (index: number) => unknown;
};

if (!arrayProto.at) {
  const at = function (this: ArrayLike<unknown>, index: number) {
    const len = this.length;
    const i = Math.trunc(index) || 0;
    const k = i < 0 ? len + i : i;
    return k >= 0 && k < len ? this[k] : undefined;
  };
  for (const proto of [Array.prototype, String.prototype]) {
    Object.defineProperty(proto, "at", {
      value: at,
      writable: true,
      configurable: true,
    });
  }
}

export {};
