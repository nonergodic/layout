import type { Layout, CustomConversion, DeriveType } from '../src';
import {
  serialize,
  deserialize,
  buildDiscriminator,
  calcStaticSize,
} from '../src';

const ipV4Item = {
  binary: "array", length: 4, layout: { binary: "uint", size: 1 }
} as const satisfies Layout;

const stringConversion = {
  to:   (encoded: Uint8Array) => new TextDecoder().decode(encoded),
  from: (decoded: string    ) => new TextEncoder().encode(decoded),
} as const satisfies CustomConversion<Uint8Array, string>;

const nameItem = {
  binary: "bytes", lengthSize: 2, custom: stringConversion
} as const satisfies Layout;

const endpointLayout = [
  { name: "header", binary: "bytes", custom: new Uint8Array([0, 42]), omit: true },
  { name: "address", binary: "switch", idSize: 1, idTag: "type", layouts: [
    [[1, "Name" ], [{ name: "value", ...nameItem }]],
    [[4, "IPv4" ], [{ name: "value", ...ipV4Item }]],
  ]},
  { name: "port", binary: "uint", size: 2 },
] as const satisfies Layout;

type Endpoint = DeriveType<typeof endpointLayout>;

describe('ReadMe Layout Examples', () => {
  describe('Showcase Example', () => {
    test('serialization', () => {
      const endpoint: Endpoint = { address: { type: "IPv4", value: [127, 0, 0, 1] }, port: 80 };
      const encoded = serialize(endpointLayout, endpoint);
      expect(encoded).toEqual(new Uint8Array([0, 42, 4, 127, 0, 0, 1, 0, 80]));
    });

    test('deserialization', () => {
      const encoded = [0, 42, 1, 0, 9, 108, 111, 99, 97, 108, 104, 111, 115, 116, 0, 80];
      const endpoint = deserialize(endpointLayout, new Uint8Array(encoded));
      expect(endpoint).toEqual({ address: { type: "Name", value: "localhost"}, port: 80 });
    });

    test('discrimination', () => {
      const ipV6Item = {
        binary: "array", length: 8, layout: { binary: "uint", size: 2 }
      } as const satisfies Layout;

      const discriminator = buildDiscriminator([ipV4Item, ipV6Item]);

      expect([4, 16, 5].map(size => new Uint8Array(size)).map(discriminator))
        .toEqual([0, 1, null]);
    });
  });

  test('Numeric Example', () => {
    const fixedDecConv = (decimals: number) => ({
      to:   (encoded: number) => encoded / 10**decimals,
      from: (decoded: number) => decoded * 10**decimals,
    } as const satisfies CustomConversion<number, number>);
    
    const hexConv = {
      to:   (encoded: bigint) => "0x" + encoded.toString(16),
      from: (decoded: string) => BigInt(decoded),
    } as const satisfies CustomConversion<bigint, string>;
    
    const numericsLayout = [
      { name: "fixedU8",  binary: "uint", size: 1, custom: 42, omit: true  },
      { name: "leI16",    binary: "int",  size: 2, endianness: "little"    },
      { name: "leU64",    binary: "uint", size: 8, endianness: "little"    },
      { name: "fixedDec", binary: "uint", size: 4, custom: fixedDecConv(2) },
      { name: "hexnum",   binary: "uint", size: 9, custom: hexConv         },
    ] as const satisfies Layout;
    
    type Numerics = DeriveType<typeof numericsLayout>;
    
    const numerics: Numerics = {
      leI16:    -2,
      leU64:    258n,
      fixedDec: 2.58,
      hexnum:   "0x1001",
    };
    const expected = [42, 254, 255, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 16, 1];

    const encoded = serialize(numericsLayout, numerics);
    expect(encoded).toEqual(new Uint8Array(expected));
    expect(deserialize(numericsLayout, encoded)).toEqual(numerics);
  });

  test('Bytes Example', () => {
    const bytesExampleLayout = [
      { name: "raw", binary: "bytes", layout: [
        { name: "vanilla", binary: "bytes", size: 3 },
        { name: "prefixed", binary: "bytes", lengthSize: 2, lengthEndianness: "little" }
      ]},
      { name: "fixed", binary: "bytes", layout: [
        { name: "vanilla", binary: "bytes", custom: new Uint8Array([0, 42]) },
        { name: "converted", binary: "bytes", custom: {
            to: "magic",
            from: new TextEncoder().encode("magic")
        }}
      ]},
      { name: "unbounded", binary: "bytes", custom: stringConversion }
    ] as const satisfies Layout;
    
    type BytesExample = DeriveType<typeof bytesExampleLayout>;
    
    const bytesExample: BytesExample = {
      raw: {
        vanilla: new Uint8Array([1, 2, 3]),
        prefixed: new Uint8Array([5, 6]),
      },
      fixed: {
        vanilla: new Uint8Array([0, 42]),
        converted: "magic",
      },
      unbounded: "utf8",
    };
    const expected = [1, 2, 3, 2, 0, 5, 6, 0, 42, 109, 97, 103, 105, 99, 117, 116, 102, 56];
    
    const encoded = serialize(bytesExampleLayout, bytesExample);
    expect(encoded).toEqual(new Uint8Array(expected));
    expect(deserialize(bytesExampleLayout, encoded)).toEqual(bytesExample);
  });

  test('Array Example', () => {
    const stringItem = {
      binary: "bytes", lengthSize: 1, custom: stringConversion
    } as const satisfies Layout;
    
    const entriesItem = {
      binary: "array", layout: { binary: "array", length: 2, layout: stringItem }
    } as const satisfies Layout;
    
    type Entries = DeriveType<typeof entriesItem>;
    //=> [string, string][]
    
    const stringMapItem = {
      binary: "bytes",
      layout: entriesItem,
      custom: {
        to: (entries: Entries) => new Map<string, string>(entries),
        from: (map: Map<string, string>) => [...map.entries()],
      }
    } as const satisfies Layout;

    const stringMap = new Map<string, string>([["m", "milli"], ["k", "kilo"]]);
    const expected = [1, 109, 5, 109, 105, 108, 108, 105, 1, 107, 4, 107, 105, 108, 111];
    
    const encoded = serialize(stringMapItem, stringMap);
    expect(encoded).toEqual(new Uint8Array(expected));
    expect(deserialize(stringMapItem, encoded)).toEqual(stringMap);
  });

  test('Switch Example', () => {
    const httpResponseItem = {
      binary: "switch",
      idSize: 2,
      idTag: "statusCode",
      layouts: [
        [200, [{ name: "result", binary: "bytes" }]],
        [404, []],
      ]
    } as const satisfies Layout;
    type HttpResponse = DeriveType<typeof httpResponseItem>;

    const response: HttpResponse = { statusCode: 200, result: new Uint8Array([0, 42]) };
    const expected = [0, 200, 0, 42];
    
    const encoded = serialize(httpResponseItem, response);
    expect(encoded).toEqual(new Uint8Array(expected));
    expect(deserialize(httpResponseItem, encoded)).toEqual(response);
  });

  test('Discrimination Example', () => {
    const layouts = [[
      { name: "fixed", binary: "uint", size: 2, custom: 0 },
      { name: "val",   binary: "uint", size: 1 },
    ], [
      { name: "fixed", binary: "bytes", custom: new Uint8Array([1, 1])  },
      { name: "val",   binary: "uint", size: 1 },
    ],
    { binary: "uint", size: 2 }
  ] as const satisfies [Layout, Layout, Layout];
  
  expect(layouts.map(calcStaticSize)).toEqual([3, 3, 2]);
  
  const discriminator = buildDiscriminator(layouts);
  //=> uses strategy: value of first byte, then size
  
  const discriminated = [
    new Uint8Array([0, 0, 0]),
    new Uint8Array([1, 1, 0]),
    new Uint8Array([0, 0]),
    new Uint8Array([0, 1, 0]),
    new Uint8Array([1, 0, 0]),
    new Uint8Array([2, 0, 0]),
    new Uint8Array([1, 0, 0, 0]),
    new Uint8Array([0]),
    ].map(discriminator);
    expect(discriminated).toEqual([0, 1, 2, 0, 1, 2, null, null]);
  });
});
