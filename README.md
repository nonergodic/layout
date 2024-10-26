# Layout Library

The Layout library implements a TypeScript-native, declarative DSL for binary data serialization/deserialization that supports strong typing and efficient, automatic discrimination of serialized data.

## Shilling

* no external dependencies
* `UInt8Array`-based (no Buffer!)
* composable \& (even third-party) customizable
* branching \& repetition
* fixed fields (padding)
* endianness
* minimizes memory allocations

## Intro/Basics

### Layouts

Layouts are comprised of named items that specify the shapes and types of binary data. Items, depending on their type, can in turn specify layouts, enabling composition/nesting.

There are 4 fundamental item types:
1. (u)int: Numeric value (signed or unsigned) that gets converted into a `number` or `bigint` by default depending on its size.
2. bytes: Raw bytes of either fixed size, or with a length prefix, or boundless(*). Supports sub-layouts for grouping. Converted into `Uint8Array` when not used as a 
3. array: Repeat a given layout. Either of fixed count, or with a count prefix, or boundless(*). Converted into an array type `[]` of the underlying layout type.
4. switch: Enable branching logic. Comparable to Rust enums. Converted into a union type of the underlying layout types.

(*) Boundless items are only valid as the last item of a layout.

### CustomConversion

(u)ints and bytes layouts can be further transformed to a custom type by providing `to` and `from` conversion functions (`to` the custom type, and `from` the custom type). Alternatively, a single, fixed value can be provided (e.g. for ids, version numbers, or padding).

### Example

**Definition**

```
const fixedDecConv = (decimals: number) => {
  to:   (encoded: number) => encoded / 10**decimals;
  from: (decoded: number) => decoded * 10**decimals;
} as const satifies CustomConversion<number, number>;

const hexConv = {
  to:   (encoded: bigint) => "0x" + encoded.toString(16),
  from: (decoded: string) => BigInt(decoded),
} as const satisfies CustomConversion<bigint, string>;

const numericsLayout = [
  { name: "fixedU8",  binary: "uint", size: 1, custom: 42, omit: true  },
  { name: "leI16",    binary: "int",  size: 2, endianness: "little"    },
  { name: "leU64",    binary: "uint", size: 8  endianness: "little"    },
  { name: "fixedDec", binary: "uint", size: 4, custom: fixedDecConv(2) },
  { name: "hexnum",   binary: "uint", size: 9, custom: hexConv         },
] as const satifies Layout;

type Numerics = LayoutToType<typeof numericsLayout>;
```
where the type `Numerics` is:
```
{
  leI16:    number; //signed number read in little endian
  leU64:    bigint; //numbers larger than 6 bytes get turned into bigints
  fixedDec: number; //encoded value / 100 custom conversion
  hexnum:   string; //bigint <> string custom conversion
}
```
and endianness is `big` by default.

**Usage**

```
const sampleObj: Numerics = {
  leI16:    -2,
  u64:      258n,
  fixedDec: 2.58,
  hexnum:   "0x1001",
};

const encoded = serialize(numericsLayout, sampleObj);
const decoded = deserialize(numericsLayout, encoded);
```
where `decoded` has type `Numerics` and equals `sampleObj` while `encoded` yields
```
 [ 42, 254, 255, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 16, 1 ]
   └┘  └──────┘  └────────────────────┘  └────────┘  └────────────────────────┘
fixedU8  leI16            leU64          fixedPoint            hexnum
```
`fixedU8` gets filled in automatically, `leI16` is stored with two's complement (-2 = ~2 + 1)

**Automatic Discrimination**

```
const secondaryLayout = [
  { name: "fixed", binary: "uint", size: 1, custom: 1, omit: true  },
  { name: "val",   binary: "uint", size: 2 },
] as const satifies Layout;

const discriminate = discriminator([numericsLayout, secondaryLayout]);

[
  encoded,
  new Uint8Array([1, 0, 0]),
  new Uint8Array([0, 0, 0]),
  new Uint8Array([1, 0, 0, 0]),
].map(discriminate); //returns [0, 1, null, null]
```

`discriminator` will use structural analysis to determine that each layout is uniquely identified by its first byte and will generate a function (`discriminate`) that uses the value of said byte for discrimination.

If `secondaryLayout` were to also use `42` as its fixed value, `discriminator` would instead fall back to discrimination based on size, since both layouts have a statically known size of 24 and 3 bytes respecively. In the general case, a greedy divide-and-conquer strategy is used that discriminates either by size or the value of a byte at a given position choosing whichever option allows reducing the set of possible layouts most aggressively.

## Layouts

Single unnamed item or array of named items.

## Funadmental Item Types in Depth

### (U)int

### Bytes

### Array

### Switch

## Type Inference

LayoutToType

## Discrimination

### Lazy Instantiation

## Guarantees & Error Handling

## Additional Item Types

### Enum Item

### Option Item

### Bitset Item

## User-defined Fields

CustomizableBytes

## Deserialization

consumeAll

## Fixed-Dynamic Utils

## Limitations

no custom on array and switch

custom conversion prevents determining size apriori

## Security Considerations

prefixed sizes can blow up memory





# Unused

```
const stringConv = {
  to:   (encoded: Uint8Array): string => new TextDecoder().decode(encoded),
  from: (decoded: string): Uint8Array => new TextEncoder().encode(decoded),
} as const satifies CustomConversion<Uint8Array, string>;

const bytesLayouts = [

] as const;

const selfReferential = [
  {
    name: "layouts",
    binary: "array",
    lengthSize: 2,
    layout: {
      binary: "switch",
      idSize: 1,
      idTag: "layoutType",
      layouts: [
        [[0, "num"], numberLayouts],
        [[1,        ], [{name: "layout", binary: "int", endianness: "little", size: 4}]],
        [[2, "sizedBytes"], [{name: "layout", binary: "bytes", size: 12 }]],
      ]
    },
  },
  {
    name: "tailText",
    binary: "bytes",
    custom: 
  }
] as const satifies Layout;
```