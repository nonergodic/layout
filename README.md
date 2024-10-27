# Layout Library

The Layout library implements a TypeScript-native, declarative DSL for binary data serialization/deserialization that supports strong typing and efficient, automatic discrimination of serialized data.

## Highlights

* standalone (no external dependencies)
* native TypeScript (no meta-compilation)
* declarative (hence DRY)
* strongly typed \& `UInt8Array`-based (no `Buffer`)
* composable \& (even third-party) customizable
* branching \& repetition
* automatic discrimination
* fixed fields
* endianness
* minimizes memory allocations

## Illustrative Example

```typescript
const ipV4Layout = {
  binary: "array", length: 4, layout: { binary: "uint", size: 1 }
} as const satisfies Layout;

const ipV6Layout = {
  binary: "array", length: 8, layout: { binary: "uint", size: 2 }
} as const satisfies Layout;

const stringConversion = {
  to:   (encoded: Uint8Array) => new TextDecoder().decode(encoded),
  from: (decoded: string    ) => new TextEncoder().encode(decoded),
} as const satisfies CustomConversion<Uint8Array, string>;

const nameLayout = {
  binary: "bytes", lengthSize: 2, custom: stringConversion
} as const satisfies Layout;

const endpointLayout = [
  { name: "header", binary: "bytes", custom: new Uint8Array([0, 42]), omit: true },
  { name: "address", binary: "switch", idSize: 1, idTag: "type", layouts: [
    [[1, "Name" ], [{ name: "value", ...nameLayout }]],
    [[4, "IPv4" ], [{ name: "value", ...ipV4Layout }]],
    [[6, "IPv6" ], [{ name: "value", ...ipV6Layout }]],
  ]},
  { name: "port", binary: "uint", size: 2 },
] as const satisfies Layout;

type Endpoint = LayoutToType<typeof endpointLayout>;
//=> { address: { type: "Name"; value: string   } |
//              { type: "IPv4"; value: number[] } |
//              { type: "IPv6"; value: number[] };
//     port: number;
//   }

const endpoint = { type: { type: "IPv4", value: [127, 0, 0, 1] }, port: 80 };
serialize(endpointLayout, endpoint);
//=> new Uint8Array([0, 42, 4, 127, 0, 0, 1, 0, 80])

const encoded = [0, 42, 1, 0, 9, 108, 111, 99, 97, 108, 104, 111, 115, 116, 0, 80];
deserialize(endpointLayout, new Uint8Array(encoded));
//=> { address: { type: "Name", value: "localhost"}, port: 80 } as Endpoint
```

**Automatic Discrimination**

```typescript
const indexOfLayout = buildDiscriminator([ipV4Layout, ipV6layout]);
[4, 16, 5]
  .map(size => new Uint8Array(size))
  .map(indexOfLayout);
//=> [0, 1, null]
```

## Intro/Basics

### Layouts and Items

A layout is an array of named layout items (or just items for short) or just a single, unnamed item. An item in turn specifies the shape and type of some piece of binary data. Depending on their type, some items can themselves contain layouts thus enabling composition and nesting.

There are 4 fundamental item types:
1. *(u)int*: Numeric value (signed or unsigned). By default, converted into a `number` or `bigint` depending on its size.
2. *bytes*: Raw bytes either have a fixed size, or a length prefix, or are boundless(*). Supports sub-layouts for grouping. By default, converted into a `Uint8Array` when not specifying a sub-layout, or an `object` otherwise.
3. *array*: Repeats a given layout. Either has fixed length, or a length prefix, or boundless(*). Converted into an array type `[]` of the underlying layout type.
4. *switch*: Enables branching logic. Comparable to Rust enums. Converted into a union type of the underlying layout types.

(*) Boundless items have a dynamic size that, when deserializing, can only be inferred from the size of the encoded data as a whole. Therefore, they are only valid as the very last item of a layout.

| Item Type | Default Converted Type                        | `custom` Property |
| --------- | --------------------------------------------- | ----------------- |
| *(u)int*  | `number` (size <= 6)<br>`bigint` (otherwise)  | ✅                |
| *bytes*   | `Uint8Array` (raw)<br>underlying (sub-layout) | ✅                |
| *array*   | underlying`[]`                                |                   |
| *switch*  | union of underlyings                          |                   |

### `LayoutToType`

Layouts can be converted into their associated type using the generic `LayoutToType` type. This, together with the `custom` property, enable strong typing without having to repeat oneself by manually defining an `interface` for the type that's described by the layout.

### `custom` Property

*(u)int* and *bytes* items support the `custom` property which supports several different use cases:
1. Specify a fixed value: This is primarily useful for adding padding, unused/reserved fields, and magic headers/version/id fields. The additional `omit` property can be set to `true` which excludes the item from taking part in the `LayoutToType` type conversion and the item will instead be filled in with its fixed value upon serialization. The introductory example uses this conversion with omission for the header field.
2. `FixedConversion`: Like specifying a fixed value, but instaed of a single, naked value, a `to` and `from` value is provided, where the `from` value specifies the expected binary data (a `number`, `bigint`, or `Uint8Array` depending on the item type), while the `from` field is the arbitrary type/value that will be returned by `LayoutToType`/`deserialize`, respectively. This is useful for e.g. giving version/id fields more explicit names like `"legacy"` instead of just `0`.
3. `CustomConversion`: Allows an arbitrary transformation of the default converted type/value into another arbitrary type/value by providing `to` and `from` conversion functions. The naming is to be understood as "`to` the custom type/value", and "`from` the custom type/value". The introductory example uses this conversion for the name item.

### Automatic Discrimination

The declarative approach of specifying layouts allows using structural analysis to generate the most efficient discrimination strategy (=discriminator) by which one can determine valid layout candidates for a given a given chunk of binary data (and a given, fixed set of layouts). One can also determine whether a discriminator can uniquely distinguish between all layouts of a given set.

For example, if all layouts in the set have a fixed, known, distinct byte value at a given position then checking the value of that byte in a given chunk of binary data will immediately reduce the number of layout candidates to either 1 or 0. Likewise, if all layouts have distinct sizes (or size ranges).

In the general case, a greedy divide-and-conquer strategy is used to generate the discriminator which, at every step, chooses to discriminate either by size or by byte-value depending on which choice is guaranteed to reduce the set of possible layouts most aggressively.

Automatic discrimination is ultimately a best effort optimization to avoid trying to deserialize a given chunk of binary data using each possibly legal layout type. It's a way to reliably exclude layouts before attempting the actual deserialization. A sensible serialization scheme should use e.g. ids to ensure easy discriminability (which will then be naturally picked up by automatic discrimination avoiding boiler-plate).

## Funadmental Item Types in Depth

First, a few words on nomenclature:

The term "size" is always used for byte counts, while the term "length" is used for counts of the underlying type. Hence *(u)int* items have sizes, while *array* items have length. For `Uint8Array` the two terms coincide and so the more specifc `size` is used for `bytes` items, though when their size is determined by a prefix, the term length is used instead (because `sizeSize` is terrible while `lengthSize` seems coherent).

The item type is specified using the `binary` property, which might seem strange at first, but `type` is a reserved keyword and hence a terrible choice, while e.g. `itemType` seems awkward in its redundant prefix. Ultimately, `binary` is a bit of a historic accident that was chosen for lack of creativity/better alternatives.

### *(U)int*



**Example**

```typescript
const fixedDecConv = (decimals: number) => {
  to:   (encoded: number) => encoded / 10**decimals;
  from: (decoded: number) => decoded * 10**decimals;
} as const satisfies CustomConversion<number, number>;

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
```typescript
{
  leI16:    number; //signed number read in little endian
  leU64:    bigint; //numbers larger than 6 bytes get turned into bigints
  fixedDec: number; //encoded value / 100 custom conversion
  hexnum:   string; //bigint <> string custom conversion
}
```
and endianness is `big` by default.

**Usage**

```typescript
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

### *Bytes*

advanced uses

### *Array*

### *Switch*

switch vs automatic discrimination

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

Using `CustomizableBytes`

## Deserialization

`offset`s and `consumeAll`

## Fixed-Dynamic Utils

## Limitations

no custom on array and switch - but can be wrapped in a `bytes` item

custom conversion prevents determining size apriori currently leading to unnecessary serializations and conversions (this could be remedied by introducing an additional `size` function that returns the amount of bytes a given `decoded` value requires to encode)

boundless items in the interior of a layout produce undefined behavior

currently can't deserialize using a discriminator directly (requires users to write boiler-plate)

## Security Considerations

Large prefix sizes can blow up memory. Consider nailing down all but the last 2-3 bytes at 0 even if the prefix size of the format technically is larger.






# Unused

**Definition**


**Automatic Discrimination**

```typescript
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


# More Unused

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