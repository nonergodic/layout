import {
  type Layout,
  serialize,
  deserialize,
} from '../src';

const numberSizes = [1, 2, 3, 4, 5, 6] as const;
const bigintSizes = [7, 8, 10, 12, 16, 32] as const;

describe('Basic Layout Tests', () => {
  test('should serialize and deserialize uint8', () => {
    const layout = {
      binary: "uint",
      size: 1
    } as const satisfies Layout;

    const value = 42;
    const encoded = serialize(layout, value);
    expect(encoded.length).toBe(1);
    expect(encoded[0]).toBe(42);

    const decoded = deserialize(layout, encoded);
    expect(decoded).toBe(value);
  });

  test('should serialize and deserialize uint64le', () => {
    const layout = {
      binary: "uint",
      size: 8,
      endianness: "little"
    } as const satisfies Layout;

    const value = 42n;
    const encoded = serialize(layout, value);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBe(layout.size);
    expect(encoded[0]).toBe(Number(value));
    for (let i = 1; i < layout.size; ++i)
      expect(encoded[i]).toBe(0);

    const decoded = deserialize(layout, encoded);
    expect(decoded).toBe(value);
  });

  test.each(numberSizes)('should throw for out of bounds uint numbers', (size) => {
    const layout = { binary: "uint", size } as const;
    const max = 2 ** (8 * size) - 1;

    expect(() => serialize(layout, max)).not.toThrow();
    expect(() => serialize(layout, max + 1)).toThrow();
    expect(() => serialize(layout, -1)).toThrow();
  });

  test.each(numberSizes)('should throw for out of bounds int numbers', (size) => {
    const layout = { binary: "int", size } as const;
    const upper = 2 ** (8 * size - 1) - 1;
    const lower = -upper - 1;

    expect(() => serialize(layout, upper)).not.toThrow();
    expect(() => serialize(layout, upper + 1)).toThrow();
    expect(() => serialize(layout, lower)).not.toThrow();
    expect(() => serialize(layout, lower - 1)).toThrow();
  });

  test.each(bigintSizes)('should throw for out of bounds uint bigints', (size) => {
    const layout = { binary: "uint", size } as const;
    const max = 2n ** (8n * BigInt(size)) - 1n;

    expect(() => serialize(layout, max)).not.toThrow();
    expect(() => serialize(layout, max + 1n)).toThrow();
    expect(() => serialize(layout, -1n)).toThrow();
  });

  test.each(bigintSizes)('should throw for out of bounds int bigints', (size) => {
    const layout = { binary: "int", size } as const;
    const upper = 2n ** (8n * BigInt(size) - 1n) - 1n;
    const lower = -upper - 1n;

    expect(() => serialize(layout, upper)).not.toThrow();
    expect(() => serialize(layout, upper + 1n)).toThrow();
    expect(() => serialize(layout, lower)).not.toThrow();
    expect(() => serialize(layout, lower - 1n)).toThrow();
  });

  test('should handle string conversion', () => {
    const stringConversion = {
      to: (encoded: Uint8Array) => new TextDecoder().decode(encoded),
      from: (decoded: string) => new TextEncoder().encode(decoded),
    } as const;

    const layout = {
      binary: "bytes",
      lengthSize: 1,
      custom: stringConversion
    } as const satisfies Layout;

    const value = "Hello, World!";
    const encoded = serialize(layout, value);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBe(layout.lengthSize + value.length);
    const decoded = deserialize(layout, encoded);
    
    expect(decoded).toBe(value);
  });
});