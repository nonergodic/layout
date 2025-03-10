import type {
  Endianness,
  NumberSize,
  NumSizeToPrimitive,
  DeriveType,
  Layout,
  BytesItem,
  FixedConversion,
  CustomConversion
} from "./layout";
import { numberMaxSize } from "./layout";
import { isLayout, isFixedBytesConversion } from "./utils";

//-------------------------------- customizableBytes --------------------------------

export type CustomizableBytes =
  undefined |
  Layout |
  Uint8Array |
  FixedConversion<Uint8Array, any> |
  CustomConversion<Uint8Array, any> |
  readonly [Layout, FixedConversion<any, any> | CustomConversion<any, any>];

export type BytesBase =
  ( {} | { readonly name: string } ) & Omit<BytesItem, "binary" | "custom" | "layout">;

type CombineObjects<T, U> = {
  readonly [K in keyof T | keyof U]: K extends keyof T ? T[K] : K extends keyof U ? U[K] : never;
};

export type CustomizableBytesReturn<B extends BytesBase, P extends CustomizableBytes> =
  CombineObjects<
    B,
    P extends undefined
    ? { binary: "bytes" }
    : P extends Layout
    ? { binary: "bytes", layout: P }
    : P extends Uint8Array | FixedConversion<Uint8Array, any> | CustomConversion<Uint8Array, any>
    ? { binary: "bytes", custom: P }
    : P extends readonly [Layout, FixedConversion<any, any> | CustomConversion<any, any>]
    ? { binary: "bytes", layout: P[0], custom: P[1] }
    : never
  >;

export const customizableBytes = <
  const B extends BytesBase,
  const C extends CustomizableBytes
>(base: B, spec?: C) => ({
  ...base,
  binary: "bytes",
  ...(() => {
    if (spec === undefined)
      return {};

    if (isLayout(spec))
      return { layout: spec };

    if (spec instanceof Uint8Array || isFixedBytesConversion(spec) || !Array.isArray(spec))
      return { custom: spec };

    return { layout: spec[0], custom: spec[1] };
  })()
} as CustomizableBytesReturn<B, C>);

//-------------------------------- boolItem --------------------------------

export function boolItem(permissive: boolean = false) {
  return {
    binary: "uint",
    size: 1,
    custom: {
      to: (encoded: number): boolean => {
        if (encoded === 0)
          return false;

        if (permissive || encoded === 1)
          return true;

        throw new Error(`Invalid bool value: ${encoded}`);
      },
      from: (value: boolean): number => value ? 1 : 0,
    }
  } as const;
}

//-------------------------------- enumItem --------------------------------

export function enumItem<
  const E extends readonly (readonly [string, number])[],
  const S extends NumberSize = 1,
  const EN extends Endianness = "big"
>(entries: E, opts?: { size?: S, endianness?: EN }) {
  const valueToName = Object.fromEntries(entries.map(([name, value]) => [value, name]));
  const nameToValue = Object.fromEntries(entries);
  return {
    binary: "uint",
    size: (opts?.size ?? 1) as S,
    endianness: (opts?.endianness ?? "big") as EN,
    custom: {
      to: (encoded: number): E[number][0] => {
        const name = valueToName[encoded];
        if (name === undefined)
          throw new Error(`Invalid enum value: ${encoded}`);

        return name;
      },
      from: (name: E[number][0]) => nameToValue[name]!,
    }
  } as const;
}

//-------------------------------- optionItem --------------------------------

const baseOptionItem = <const T extends CustomizableBytes>(someType: T) => ({
  binary: "switch",
  idSize: 1,
  idTag: "isSome",
  layouts: [
    [[0, false], []],
    [[1, true ], [customizableBytes({ name: "value"}, someType)]],
  ]
} as const);

type BaseOptionItem<T extends CustomizableBytes> =
  DeriveType<ReturnType<typeof baseOptionItem<T>>>;

type BaseOptionValue<T extends CustomizableBytes> =
  DeriveType<CustomizableBytesReturn<{}, T>> | undefined;

export function optionItem<const T extends CustomizableBytes>(optVal: T) {
  return {
    binary: "bytes",
    layout: baseOptionItem(optVal),
    custom: {
      to: (obj: BaseOptionItem<T>): BaseOptionValue<T> =>
        obj.isSome === true
        //typescript is not smart enough to narrow the outer type based on the inner type
        ? (obj as Exclude<typeof obj, {isSome: false}>)["value"]
        : undefined,
      from: (value: BaseOptionValue<T>): BaseOptionItem<T> =>
        value === undefined
        ? { isSome: false }
        : { isSome: true, value } as any, //good luck narrowing this type
    } satisfies CustomConversion<BaseOptionItem<T>, BaseOptionValue<T>>
  } as const
};

//-------------------------------- bitsetItem --------------------------------

export type Bitset<B extends readonly (string | undefined)[]> =
  {[K in B[number] as K extends "" | undefined ? never : K]: boolean};

type ByteSize = [
  never,
  1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 2, 2, 2, 2, 2, 2,
  3, 3, 3, 3, 3, 3, 3, 3,
  4, 4, 4, 4, 4, 4, 4, 4,
  5, 5, 5, 5, 5, 5, 5, 5,
  6, 6, 6, 6, 6, 6, 6, 6,
];

type BitsizeToBytesize<N extends number> = N extends keyof ByteSize ? ByteSize[N] : number;

export type BitsetItem<
  B extends readonly (string | undefined)[],
  S extends number = BitsizeToBytesize<B["length"]>,
> = {
  binary: "uint";
  size: S;
  custom: {
    to: (encoded: NumSizeToPrimitive<S>) => Bitset<B>;
    from: (obj: Bitset<B>) => NumSizeToPrimitive<S>;
  };
};

export function bitsetItem<
  const B extends readonly (string | undefined)[],
  const S extends number = BitsizeToBytesize<B["length"]>,
>(bitnames: B, size?: S): BitsetItem<B, S> {
  return {
    binary: "uint",
    size: (size ?? Math.ceil(bitnames.length / 8)) as S,
    custom: {
      to: (encoded: NumSizeToPrimitive<S>): Bitset<B> => {
        const ret: Bitset<B> = {} as Bitset<B>;
        for (let i = 0; i < bitnames.length; ++i)
          if (bitnames[i]) //skip undefined and empty string
            //always use bigint for simplicity
            ret[bitnames[i] as keyof Bitset<B>] = (BigInt(encoded) & (1n << BigInt(i))) !== 0n;

        return ret;
      },
      from: (obj: Bitset<B>): NumSizeToPrimitive<S> => {
        let val = 0n;
        for (let i = 0; i < bitnames.length; ++i)
          if (bitnames[i] && obj[bitnames[i] as keyof Bitset<B>])
            val |= 1n << BigInt(i);

        return (bitnames.length > numberMaxSize ? val : Number(val)) as NumSizeToPrimitive<S>;
      },
    },
  } as const
}
