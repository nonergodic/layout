# Layout Library

[![npm version](https://img.shields.io/npm/v/binary-layout.svg)](https://www.npmjs.com/package/binary-layout)

The Layout library implements a TypeScript-native, declarative DSL for binary data serialization/deserialization that supports strong typing and efficient, automatic discrimination of data formats.

A must-have for anyone unfortunate enough to work with binary data in TypeScript.

## Highlights

* **Standalone**: no external dependencies
* **Pure**: just TypeScript, no code generation or meta-compilation
* **Declarative**: DRY spec for types, (de)serialization, and automatic discrimination
* **Composable**: nested and repeatable structures
* **Flexible**: conditional/branching structures, fixed fields, and endian support
* **Modern**: strong, customizable types and `UInt8Array`-based ([no more `Buffer`](https://sindresorhus.com/blog/goodbye-nodejs-buffer))
* **Efficient**: minimizes memory allocations

## Showcase Example

```typescript
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
//=> { address: { type: "Name"; value: string } |
//              { type: "IPv4"; value: [number, number, number, number] };
//     port: number;
//   }

const endpoint = { address: { type: "IPv4", value: [127, 0, 0, 1] }, port: 80 };
serialize(endpointLayout, endpoint);
//=> new Uint8Array([0, 42, 4, 127, 0, 0, 1, 0, 80])
//                  └─┬──┘  ╿  └────┬─────┘  └┬──┘
//                  header type   value      port

const encoded = [0, 42, 1, 0, 9, 108, 111, 99, 97, 108, 104, 111, 115, 116, 0, 80];
//               └┬───┘ ╿  └─┬┘  └─────────────────┬─────────────────────┘  └┬──┘
//               header type length             value (utf8)                port
deserialize(endpointLayout, new Uint8Array(encoded));
//=> { address: { type: "Name", value: "localhost"}, port: 80 } as Endpoint
```

**Automatic Discrimination**

```typescript
const ipV6Item = {
  binary: "array", length: 8, layout: { binary: "uint", size: 2 }
} as const satisfies Layout;

const discriminator = buildDiscriminator([ipV4Item, ipV6Item]);
//=> builds size-based discriminator

[4, 16, 5].map(size => new Uint8Array(size)).map(discriminator);
//=> [0, 1, null] - indices of candidate layouts
```

## Intro/Basics

### Layouts and Items

A layout is an array of named items or just a single, unnamed item. An item in turn specifies the shape and type of some piece of binary data. Depending on their type, some items can themselves contain layouts thus enabling composition and nesting.

There are 4 fundamental item types:
1. [*(u)int*](#uint): Numeric value (signed or unsigned). By default, converted into a `number` or `bigint` depending on its size.
2. [*bytes*](#bytes): Raw bytes either have a fixed size, or a length prefix, or are boundless\*. Supports sub-layouts for grouping. By default, converted into a `Uint8Array` when not specifying a sub-layout, or an `object` otherwise.
3. [*array*](#array): Repeats a given layout. Either has fixed length, or a length prefix, or is boundless\*. Converted into a tuple type `[L, ..., L]` for known, fixed length, or an array type `L[]`, where `L` is the derived type of its layout.
4. [*switch*](#switch): Enables branching logic. Comparable to Rust enums. Converted into a union type of the derived types of its layout variants.

\* Boundless items have a dynamic size that, when deserializing, can only be inferred from the size of the encoded data as a whole. Therefore, they are only valid as the very last item of a layout.

| Item Type | (Default) Derived Type                        | `custom` Property |
| --------- | --------------------------------------------- | ----------------- |
| *(u)int*  | `number` (size <= 6)<br>`bigint` (otherwise)  | ✅                |
| *bytes*   | `Uint8Array` (raw)<br>underlying (sub-layout) | ✅                |
| *array*   | tuple (fixed length)<br>array (otherwise)     |                   |
| *switch*  | union of variants                             |                   |

### `DeriveType`

> (Default) derived types are fully `readonly` qualified but examples in this README omit it for better readability.

Layouts can be converted into their associated type using the generic `DeriveType` type. For layouts that aren't single, unnamed items, this is an object with property names corresponding to the layout's item names and their associated item types. An item's associated type is its (default) derived type unless it is transformed further via the [`custom` property](#custom-property).

`DeriveType` and the `custom` property enable strong typing without having to repeat oneself by manually defining an `interface` for the type that's described by the layout, which is one of the common issues with serialization code that uses an imperative approach.

### `custom` Property

*(u)int* and *bytes* items support the optional `custom` property which enables several different use cases:
1. Specify a fixed value: This is primarily useful for adding padding, unused/reserved fields, and magic headers/version/id fields. The additional `omit` property can be set to `true` which excludes the item from taking part in the `DeriveType` type conversion and the item will instead be filled in with its fixed value upon serialization. The introductory example uses this conversion with omission for the header field.
2. `FixedConversion`: Like specifying a fixed value, but instead of a single, naked value, a `to` and `from` value is provided, where the `from` value specifies the expected binary data (a `number`, `bigint`, or `Uint8Array` depending on the item type), while the `from` field is the arbitrary type/value that will be returned by `DeriveType`/`deserialize`, respectively. This is useful for e.g. giving version/id fields more explicit names like `"legacy"` instead of just `0`.
3. `CustomConversion`: Allows an arbitrary transformation of the default converted type/value into another arbitrary type/value by providing `to` and `from` conversion functions. The naming is to be understood as "`to` the custom type/value", and "`from` the custom type/value". The introductory example uses this conversion for the name variant of the address *switch* item.

### Automatic Discrimination

The declarative approach of specifying layouts allows using structural analysis to generate the most efficient discrimination strategy (=discriminator) by which one can determine valid layout candidates for a given a given chunk of binary data (and a given, fixed set of layouts). One can also determine whether a discriminator can uniquely distinguish between all layouts of a given set.

For example, if all layouts in the set have a fixed, known, distinct byte value at a given position then checking that value of a given chunk of binary data will immediately reduce the number of layout candidates to at most one. Likewise, if all layouts have distinct sizes or size ranges.

In the general case, a greedy divide-and-conquer strategy is used to generate the discriminator which, at every step, chooses to discriminate either by size or by byte-value depending on which choice is guaranteed to reduce the set of possible layouts most aggressively.

Automatic discrimination is ultimately a best effort optimization to avoid trying to deserialize a given chunk of binary data using each possibly legal layout type. It's a way to reliably exclude layouts before attempting the actual deserialization. A sensible serialization scheme should use e.g. distinct ids at the start to ensure easy discriminability (which will then be naturally picked up by automatic discrimination avoiding the need to write boiler-plate code).

## Fundamental Item Types in Depth

A few words on nomenclature:

The term "size" is always used for byte counts, while the term "length" is used for counts of the underlying type. Hence *(u)int* items have sizes, while *array* items have length. For `Uint8Array` the two terms coincide and so the more specific `size` is used for `bytes` items, though when their size is determined by a prefix, the term length is used instead (because `sizeSize` is terrible while `lengthSize` seems coherent).

The item type is specified using the `binary` property which is the only mandatory property type that all items have in common. This identifier might seem strange, but `type` is a reserved keyword and thus an awkward choice✱ and e.g. `itemType` seems cumbersome in its redundant prefix. The intuition pump for this choice is "What's the most basic datatype that's encoded in the binary? Is it just raw data? A number? An array? Or something conditional?". Ultimately though, `binary` is admittedly a bit of a historic accident that was chosen for lack of creativity/better alternatives.

✱ Yes, it is used in the [introductory example](#illustrative-example) regardless.

### *(U)int*

| Property   | Type                         | Existence                               |
| ---------- | ---------------------------- | --------------------------------------- |
| binary     | `"int" \| "uint"`            | mandatory                               |
| size       | `number`                     | mandatory                               |
| endianness | `"big" \| "little"`          | default: `"big"`                        |
| custom     | [see here](#custom-property) | optional                                |
| omit       | `boolean`                    | only for fixed values, default: `false` |

> **Default derived type:**
> | Type       | Condition   |
> | ---------- | ----------- |
> | `number`   | `size <= 6` |
> | `bigint`   | otherwise   |
>
> The cutoff is 6 bytes because it is the maximum size integer a `number` can hold without loss of precision.

Signed integers are stored using two's complement. Default endianness for all numerics (i.e. *(u)int*s and length prefixes) is always big.

While, *(u)int* items are more of a convenience type since anything they provide could also be accomplished by a *bytes* item with a custom conversion, their ubiquity justifies a dedicated type. This ambiguity tends to stand out particularly when implementing fixed values for e.g. padding, where both `{ binary: "bytes", custom: new Uint8Array(3) }` and `{ binary: "uint", size: 3, custom: 0 }` are equally viable choices.

There is no built-in support for floating-point numbers, so a [custom conversion](#custom-property) is required in such cases.

**Example**

```typescript
const fixedDecConv = (decimals: number) => ({
  to:   (encoded: number) => encoded / 10**decimals,
  from: (decoded: number) => decoded * 10**decimals,
} as const satisfies CustomConversion<number, number>);

const hexConv = { //for demo only, bigints should be preferred over hex strings
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
//=> { leI16:    number; //signed number read in little endian
//     leU64:    bigint; //numbers larger than 6 bytes get turned into bigints
//     fixedDec: number; //encoded value / 100 custom conversion
//     hexnum:   string; //bigint <> string custom conversion
//   }

const numerics: Numerics = {
  leI16:    -2,
  leU64:    258n,
  fixedDec: 2.58,
  hexnum:   "0x1001",
};

const encoded = serialize(numericsLayout, numerics);
//=> new Uint8Array([42, 254, 255, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 16, 1])
//                   ├┘  └────┬─┘  └──────────┬─────────┘  └───┬────┘  └───────────┬────────────┘
//                 fixedU8  leI16           leU64          fixedPoint            hexnum
const decoded = deserialize(numericsLayout, encoded);
//=> equal to numerics (same type and value)
```

### *Bytes*

| Property         | Type                         | Existence                                |
| ---------------- | ---------------------------- | ---------------------------------------- |
| binary           | `"bytes"`                    | mandatory                                |
| size             | `number`                     | mutually exclusive with lengthSize, ✱    |
| lengthSize       | `1 \| 2 \| 3 \| 4 \| 5 \| 6` | mutually exclusive with size, ✱          |
| lengthEndianness | `"big" \| "little"`          | only with `lengthSize`, default: `"big"` |
| layout           | `Layout`                     | optional, ✱, ✚                           |
| custom           | [see here](#custom-property) | optional, ✱                              |
| omit             | `boolean`                    | only for fixed values, default: `false`  |

> **Default derived type:**
> | Type         | Condition                 |
> | ------------ | ------------------------- |
> | `object`     | specifies layout property |
> | `Uint8Array` | otherwise                 |

✚ The layout property allows specifying a sub-layout, enabling grouping/nesting by combining all items of that sub-layout into a new object with the name of the enclosing *bytes* item. While this allows for pointless constructions if the outer *bytes* item is unnamed (e.g. `{ binary: "bytes", layout: { binary: "bytes" } }`), it also enables wrapping other unnamed items like *switch* or *array* items thus circumventing their lack of native support of the custom property, by leveraging custom support of the enclosing *bytes* item (see `stringMapLayout` in [*array* example](#array)). Likewise, the default way of specifying a layout as an array of named items can therefore be thought of as a special case of an unnamed *bytes* item that specifies the same layout for its layout property. I.e. `[/*items*/] as const satisfies Layout` is effectively equivalent to `{ binary: "bytes", layout: [/*items*/] } as const satisfies Layout` and the latter can be used if a custom conversion of the outer most layout into some other type is desired.

Number of bytes written/read by a *bytes* item:
* *size*: If a size is explicitly specified, it must be consistent with the *fixed* custom field (a `Uint8Array` value or a `FixedConversion`) or the layout (if specified).
* *lengthSize*: If a lengthSize is specified, it will encode the size of the data on serialization, and must match the size of the conversion/layout on deserialization.
* *deduced or boundless*: If neither a size, nor a lengthSize is specified, and the size is not derivable from the custom property (i.e. it's undefined, or a `CustomConversion`), or the sub-layout (whose size can't be statically determined), the *bytes* item is boundless. This means it is serialized "as is" and upon deserialization, all remaining encoded data is assigned to it. Therefore boundless *bytes* are only valid at the end of a layout and constructs such as `[{ name: "invalidBoundless", binary: "bytes" }, { name: "tail", binary: "uint", size: 1 }]` are considered to have undefined behavior even though in some cases (such as this one) the intended size of the boundless *bytes* item would be deducible (see below for a way to handle this case if it is truly necessary).

✱ While size and lengthSize are mutually exclusive, it is legal to redundantly specify them for cases where the size can be statically inferred from the layout or custom property (e.g. `{ binary: "bytes", size: 3, custom: new Uint8Array(3) }`). For the rationale see [`CustomizableBytes`](#customizablebytes).

**Example**

```typescript
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
//=> { raw: { vanilla: Uint8Array; prefixed: Uint8Array };
//     fixed: { vanilla: Uint8Array; converted: "magic" };
//     unbounded: string;
//   }

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

serialize(bytesExampleLayout, bytesExample);
//=> new Uint8Array([1, 2, 3, 2, 0, 5, 6, 0, 42, 109, 97, 103, 105, 99, 117, 116, 102, 56])
//                   └┬────┘  └─┬┘  └─┬┘  └──┬┘  └───────────────┬───┘  └───────┬───────┘
//               raw.vanilla  raw.prefixed fixed.vanilla fixed.converted    unbounded
```

### *Array*

| Property         | Type                         | Existence                                    |
| ---------------- | ---------------------------- | -------------------------------------------- |
| binary           | `"bytes"`                    | mandatory                                    |
| length           | `number`                     | optional, mutually exclusive with lengthSize |
| lengthSize       | `1 \| 2 \| 3 \| 4 \| 5 \| 6` | optional, mutually exclusive with length     |
| lengthEndianness | `"big" \| "little"`          | only with lengthSize, default: `"big"`       |
| layout           | `Layout`                     | mandatory                                    |

> **Derived type:**
> | Type        | Condition           |
> | ----------- | ------------------- |
> | `tuple<DT>` | known, fixed length |
> | `DT[]`      | otherwise           |
> 
> Where `DT` is the derived type of the layout property and `tuple<DT>` is a tuple of the given length.

*Array* items allow repetition of a given layout. As [mentioned before](#fundamental-item-types-in-depth), lengths encode counts of the underlying and hence only coincides with size if the underlying requires only a single byte to serialize.

```typescript
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

DeriveType<typeof stringMapItem>
//=> Map<string, string>

serialize(stringMapItem, new Map<string, string>([["m", "milli"], ["k", "kilo"]]));
//=> new Uint8Array([1, 109, 5, 109, 105, 108, 108, 105, 1, 107, 4, 107, 105, 108, 111])
//                   ╿  └┬┘  ╿  └─┬───────────────────┘  ╿  └┬┘  ╿  └─┬──────────────┘
//                  [ "m"  , "milli" ]                  [ "k"  , "kilo" ]
```

### *Switch*

| Property         | Type                         | Existence        |
| ---------------- | ---------------------------- | ---------------- |
| binary           | `"switch"`                   | mandatory        |
| idSize           | `1 \| 2 \| 3 \| 4 \| 5 \| 6` | mandatory        |
| idEndianness     | `"big" \| "little"`          | default: `"big"` |
| idTag            | `string`                     | default: `"id"`  | 
| layouts          | ✱                            | mandatory        |

✱ The layouts property is an array of pairs, i.e. tuples with two entries, which specify the variants of the *switch* item. All such pairs must either be of type `[number, ProperLayout]` or of type `[[number, unknown], ProperLayout]`. The second entry `ProperLayout` is an array of named items, i.e. a `Layout` that is not an unnamed item. The first entry is either a plain unsigned integer (the id of the variant), or another pair that contains the id as the first entry and its mapped value (similar to a `FixedConversion`) as its second entry.

Putting it all together, the type of the layouts property is therefore: `[number, ProperLayout][] | [[number, unknown], ProperLayout][]`. It therefore enforces that either all id values are mapped or none are. Mixing of mapped id types is possible though rarely sensible.

> **Derived type:**
> `DeriveType` always transforms a *switch* item into a union of objects where each objects represents one of its variants. Every such object contains the normal, derived type of its layout with one additional property whose name is specified by the idTag property and whose value is either the mapped id value if it exists, or just the plain id value of the variant otherwise. A variant layout that has an item with the same name as the chosen idTag value will result in undefined behavior.

**Example**

```typescript
const httpResponseItem = {
  binary: "switch",
  idSize: 2,
  idTag: "statusCode",
  layouts: [
    [200, [{ name: "result", binary: "bytes" }]],
    [404, []],
  ]
} as const satisfies Layout;

DeriveType<typeof httpResponseItem>;
//=> { statusCode: 200; result: Uint8Array } | { statusCode: 404 }

serialize(httpResponseItem, { statusCode: 200, result: new Uint8Array([0, 42]) });
//=> new Uint8Array([0, 200, 0, 42])
//                   └─┬──┘  └─┬─┘
//               statusCode  result
```

As another example, see the address item in the `endpointLayout` of the [introductory example](#illustrative-example).

## More on Automatic Discrimination

Expanding on the [introductory explanation](#automatic-discrimination): Besides the layouts to be discriminated, `buildDiscriminator()` also takes a `boolean` which determines whether the resulting strategy must be able to reduce the resulting candidates to at most one (and hence the discriminator can return `number | null`, where `number` is the index of that candidate in the array of the passed payloads) or whether ambiguity is allowed/possible and hence multiple candidates can be returned (i.e. `number[]`). If a definitive discriminator can't be found but was requested, `buildDiscriminator()` will throw.

Layout discriminators guarantee perfect specificity (no false negatives) but not necessarily perfect sensitivity (no false positives). In other words, a discriminator never removes a layout that could be used to successfully deserialize a given piece of binary data, but it might return a candidate (hence candidate!) which might ultimately fail to deserialize.

**Example**

```typescript
const layouts = [[
    { name: "fixed", binary: "uint", size: 2, custom: 0 },
    { name: "val",   binary: "uint", size: 1 },
  ], [
    { name: "fixed", binary: "bytes", custom: new Uint8Array([1, 1])  },
    { name: "val",   binary: "uint", size: 1 },
  ],
  { binary: "uint", size: 2 }
] as const satisfies [Layout, Layout, Layout];

layouts.map(calcStaticSize);
//=> [3, 3, 2]

const discriminator = buildDiscriminator(layouts);
//=> uses strategy: value of first byte, then size

[
  new Uint8Array([0, 0, 0]),    //=> 0 - true positive, deserializes to first layout
  new Uint8Array([1, 1, 0]),    //=> 1 - true positive, deserializes to second layout
  new Uint8Array([0, 0]),       //=> 2 - true positive, deserializes to third layout
  new Uint8Array([0, 1, 0]),    //=> 0 - false positive, fails deserialization on second byte
  new Uint8Array([1, 0, 0]),    //=> 1 - false positive, fails deserialization on second byte
  new Uint8Array([2, 0, 0]),    //=> 2 - false positive, fails deserialization on size
  new Uint8Array([1, 0, 0, 0]), //=> null - true negative
  new Uint8Array([0]),          //=> null - true negative
].map(discriminator);
```

### Automatic discrimination vs. *Switch*

Automatic discimination and *switch* items are somewhat similar in that they both allow distinguishing between different layouts/layout variants. E.g. having two separate layouts that have a distinct, known, fixed id field as their first item and using automatic discrimination functionally yields the same result as combining these layouts within a single *switch* item as two separate variants. In such cases, the choice between these two approaches primarily comes down to the desired level of coupling.

If the serialized format is not under one's control however, using a *switch* item in such a fashion might not always be possible (see the previous example). At the same time, discriminators do not afford the same flexibility to seamlessly distinguish and deserialize sub-layouts as *switch* items allow.

Finally, discriminators have to be built while *switch* items work on a purely declarative basis.

### Limitations of Discriminators

**Limited scope**

Layout discriminators do not guarantee that all layouts that can be statically distinguished will be.

Since disciminators only work on size ranges and fixed byte values, it's easy to construct cases that are trivial to distinguish:

```typescript
const even = {
  binary: "array", layout: { binary: "uint", size: 2}
} as const satisfies Layout;

const odd = [
  { name: "plusOne", binary: "uint", size: 1 },
  { name: "even", ...even },
] as const satisfies Layout;
```

From the point of view of the discriminator, `even` has a size range of 0 to infinity, while `odd` has a size range of 1 to infinity, hence their ranges overlap and can't be used to discriminate between them. But of course their size makes it perfectly trivial to distinguish them.

**Not necessarily optimal**

Since layout discriminators use a greedy approach to construct a strategy, they do not necessarily find an optimal strategy.

**Startup time**

Typically, layouts are statically defined and hence known "at compile time". But since JavaScript has no compile-time evaluation, discriminators have to be built upon startup.

So to avoid overly long startup times for applications that make heavy use of discriminators, one should consider using lazy instantiation:

```typescript
function lazyInstantiate<T>(factory: () => T): () => T {
  let instance: T | null = null;
  return () => {
    if (!instance)
      instance = factory();
    return instance;
  }
}

const costlyToBuildDiscriminator = lazyInstantiate(() =>
 buildDiscriminator(arrayOfManyComplexLayouts)
);
```

## Guarantees & Error Handling

On the one hand - as evidenced throughout this document by the very liberally declaring incorrect use of the DSL as simply undefined behavior - this package/library takes a somewhat unconcerned approach to programmer error.

But on the other hand, it is also values meticulousness by ensuring that if the DSL is used correct, there's no way to generate unexpected, inconsistent, or insecure results at runtime:
* *(U)int* items always check their value ranges and throw upon serialization if the provided value does not fit in the allotted size. This also applies to length prefixes.
* Malicious data in length prefixes will never cause unreasonably large allocations that could crash the application upon deserialization.
* When deserializing data, it will automatically check that all the data is accounted for exactly, unless the `consumeAll` parameter is deliberately set to `false`.

These guarantees, together with all the limitations that are naturally imposed by strong typing, should radically cut down on all the programmatic errors that are associated with binary serialization.

Of course it is still up to user applications to check the internal coherence of any data received from external, potentially untrusted sources.

## Additional Item Types

The following item types are built on top of the above primitives to cover some common use cases.

They also serve as examples for how to leverage layouts for more advanced use cases.

### CustomizableBytes

It is a common pattern that layouts define a certain structure, while also wanting to allow customization of certain portions of that structure. For example network packets can be thought of as layouts with a known header, followed by a user defined body/payload. This body might simply be the rest of the data, or it might have some prefixed length or even known, fixed size.

A natural way to enable this sort of customizability is to specify a layout that contains a *bytes* item with the given size/lengthSize fields, but with an overrideable custom field, where the generic version simply leaves custom unspecified resulting in a raw `Uint8Array`.

**Notes on possible redundancy in the specification of *bytes* items**

Allowing such overriding can lead to somewhat awkward combinations though. If layouts are only ever defined by a single party, it would never make sense to specify e.g. both a size and a `FixedConversion`, since the former could be derived from the latter. But if multiple parties are involved, one party might want to nail down the size of the data itself, or the size and endianness of the length field, while another then specifies what the actual content is (and this might even be done recursively, where one protocol builds on top of another), which can lead to redundant specification.

But to facilitate this use case, *bytes* items do indeed allow for this sort of redundancy, and it is up to users to ensure that the specs are consistent to avoid undefined behavior.

**Usage**

The `customizableBytes` function and its associated `CustomizableBytes` type is a way to specify such a parameterized, customizable layout.

An example (building on the introductory example) is probably best to illustrate its usage:

```typescript
//define the template
const packetTemplate = <const P extends CustomizableBytes = undefined>(payload?: P) => [
  ...endpointLayout,
  customizableBytes({ name: "payload", lengthSize: 2 }, payload),
] as const satisfies Layout;

//the generic type with no specialization:
const packetLayout = packetTemplate();
DeriveType<typeof packetLayout>["payload"];
//=> Uint8Array

//specifying a conversion
const stringPacketLayout = packetTemplate(stringConversion);
DeriveType<typeof stringPacketLayout>["payload"];
//=> string

const numberArrayItem = {
  binary: "array", layout: { binary: "uint", size: 4 }
} as const satisfies Layout;

//specify a layout:
const numberPacketLayout = packetTemplate(numberArrayItem);
DeriveType<typeof numberPacketLayout>["payload"];
//=> number[]

const setConversion = {
  to: (encoded: number[]) => new Set<number>(encoded),
  from: (decoded: Set<number>) => [...decoded],
} as const satisfies CustomConversion<number[], Set<number>>;

//specify both:
const dateArrayPacketLayout = packetTemplate([numberArrayItem, setConversion]);
DeriveType<typeof dateArrayPacketLayout>["payload"];
//=> Set<number>
```

### Bool Item

Converts a boolean into a single byte.

Implemented via a *uint* item. Strict by default, i.e. only accepts 1 and 0 as the valid values, but can be set to be permissive so any non-zero value counts as true.

```typescript
const strictBool = boolItem();
const permissiveBool = boolItem(true);
deserialize(strictBool, new Uint8Array([2]));
//=> throws
deserialize(permissiveBool, new Uint8Array([2]));
//=> true
```

### Enum Item

Converts a set of string values into their associated numeric values.

Implemented via a *uint* item. Default size is 1, default endianness is big.

```typescript
const myEnumItem = enumItem([["foo", 1], ["bar", 3]], { size: 2, endianness: "little" });

DeriveType<typeof myEnumItem>;
//=> "foo" | "bar"
```

### Option Item

Default implementation for encoding optional parts of a layout. Inspired by Rust's `Option` type.

Implemented via a *switch* item wrapped in a *bytes* item to get the desired custom conversion.

```typescript
const myOptionItem = optionItem({ binary: "uint", size: 2 });

DeriveType<typeof myOptionItem>; //=> number | undefined

serialize(myOptionItem, undefined); //=> new Uint8Array([0])
serialize(myOptionItem, 42); //=> new Uint8Array([1, 0, 42])
```

### Bitset Item

Default implementation for encoding bitsets/bitmasks. Takes an array of strings to name the bits/flags. Empty strings or undefined can be used to leave individual bits unnamed. Always in big endian, i.e. first string names the rightmost bit.

Implemented via a *uint* item.

```typescript
const myBitsetItem = bitsetItem(["foo", "", "bar", undefined, "baz"]);
DeriveType<typeof myBitsetItem>;
//=> {[key in "foo" | "bar" | "baz"]: boolean};

serialize(myBitsetItem, { foo: false, bar: true, baz: true });
//=> new Uint8Array([0b00010100])
//                      ┌─┚ ╿ ┖─┐
//                     baz bar foo
```

## Fixed-Dynamic Utils

There are two utility functions that allow filtering layouts for their fixed and dynamic items:
* `fixedItemsOf`
* `dynamicItemsOf`

They are used to implement a third utility function called `addFixedValues` which completes a partial derived type by filling in the missing, required, fixed values of its layout (which were not marked via `omit: true`). This can be useful to e.g. avoid forcing users to specify a fixed version field on every use while still including that version field in the deserialized object.

## Limitations

* Does not support circular layout definitions (e.g. can't model `type Dir = (Dir | File)[]`).

* *Array* and *bytes* lengths have to be encoded right before their data (work around via custom property and defining an adhoc layout is possible but awkward).

* No "symlinks", i.e. no arbitrary references to other fields. The custom property can be used to validate individual values, but cross-validation between values has to be done "one level up".

* No custom property on *array* and *switch* items (but workaround via wrapping in a `bytes` item).

* Currently can't deserialize using a discriminator directly (requires users to write boiler-plate).

## History/Renamings

This library originated [here](https://github.com/nonergodic/sdkv2/blob/main/1-base-layer/src/utils/layout.ts), was then moved over and developed further [here](https://github.com/wormhole-foundation/wormhole-sdk-ts/tree/main/core/base/src/utils/layout), before finally being extracted into its own standalone repository.

Some issues were fixed, some features added, and the following renamings were applied:

| Old                  | New                |
| -------------------- | ------------------ |
| LayoutToType         | DeriveType         |
| serializeLayout      | serialize          |
| deserializeLayout    | deserialize        |
| layoutDiscriminator  | buildDiscriminator |
| calcLayoutSize       | calcSize           |
| calcStaticLayoutSize | calcStaticSize     |

and also
* `s/LayoutItem/Item/g`
* `s/OfLayout/Of/g`
