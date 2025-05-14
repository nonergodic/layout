import type {
  Layout,
  Item,
  SwitchItem,
  FixedConversion,
  NumType,
  BytesType,
  PrimitiveType,
  FlexLayoutBytes,
  LengthPrefixedLayoutBytes,
  ManualSizeLayoutBytes,
} from "./layout";
import { binaryLiterals } from "./layout";

export const isNumType = (x: any): x is NumType =>
  typeof x === "number" || typeof x === "bigint";

export const isBytesType = (x: any): x is BytesType => x instanceof Uint8Array;

export const isPrimitiveType = (x: any): x is PrimitiveType =>
  isNumType(x) || isBytesType(x);

export const isItem = (x: any): x is Item => binaryLiterals.includes(x?.binary);

export const isLayout = (x: any): x is Layout =>
  isItem(x) || Array.isArray(x) && x.every(isItem);

const isFixedNumberConversion = (custom: any): custom is FixedConversion<number, any> =>
  typeof custom?.from === "number";

const isFixedBigintConversion = (custom: any): custom is FixedConversion<bigint, any> =>
  typeof custom?.from === "bigint";

export const isFixedUintConversion = (custom: any): custom is
    FixedConversion<number, any> | FixedConversion<bigint, any> =>
  isFixedNumberConversion(custom) || isFixedBigintConversion(custom);

export const isFixedBytesConversion = (custom: any): custom is FixedConversion<BytesType, any> =>
  isBytesType(custom?.from);

export const isFixedPrimitiveConversion = (custom: any): custom is
    FixedConversion<number, any> | FixedConversion<bigint, any> | FixedConversion<BytesType, any> =>
  isFixedUintConversion(custom) || isFixedBytesConversion(custom);

export const checkSize = (layoutSize: number, dataSize: number): number => {
  if (layoutSize !== dataSize)
    throw new Error(`size mismatch: layout size: ${layoutSize}, data size: ${dataSize}`);

  return dataSize;
}

//In a better world, we wouldn't need this type guard and could just check for "layout" in bytesItem
//  directly because no layout item actually allows for its layout property (if it has one) to be
//  `undefined`.
//
//The problem arises in how TypeScript checks `satisfies` constraints that involve unions:
//Consider:
//```
//const shouldBeIllegal = {
//  binary: "bytes", layout: undefined,
//} as const satisfies FlexPureBytes | FlexLayoutBytes;
//```
//
//This should be illegal because `FlexPureBytes` does not specify a layout property, so its
//  specification would be excessive and `FlexLayoutBytes` does not allow for its `layout` property
//  to be `undefined`.
//But when checking a `satisfies` constraint of unions of interfaces, excessive properties are
//  actually ignored and so the `satisfies` constraint will be considered fulfilled, even though it
//  neither member of the union by itself satisfies it - how utterly counterintuitive.
//
//Given that it is fairly natural - though strictly speaking incorrect - to write the following:
//```
//const someBytesTemplate = <const L extends Layout | undefined = undefined>(layout?: L) => ({
//  binary: "bytes", layout: layout as L,
//} as const satisfies Item);
//```
//and because TypeScript fails to alert us that it does in fact not satisfy any bytes item at all,
//  we instead introduce an additional check in our implementation that not only is a layout
//  property present but that it is also not `undefined`.
export const bytesItemHasLayout = (bytesItem: { readonly binary: "bytes" }):
  bytesItem is FlexLayoutBytes | ManualSizeLayoutBytes | LengthPrefixedLayoutBytes =>
    "layout" in bytesItem && bytesItem.layout !== undefined;

export const checkItemSize = (item: any, dataSize: number): number =>
  ("size" in item && item.size !== undefined) ? checkSize(item.size, dataSize) : dataSize;

export const checkNumEquals = (custom: number | bigint, data: number | bigint): void => {
  if (custom != data)
    throw new Error(`value mismatch: (constant) layout value: ${custom}, data value: ${data}`);
}

export const checkBytesTypeEqual = (
  custom: BytesType,
  data: BytesType,
  opts?: {
    customSlice?: number | readonly [number, number];
    dataSlice?: number | readonly [number, number];
  }): void => {
  const toSlice = (bytes: BytesType, slice?: number | readonly [number, number]) =>
    slice === undefined
      ? [0, bytes.length] as const
      : Array.isArray(slice)
      ? slice
      : [slice, bytes.length] as const;

  const [customStart, customEnd] = toSlice(custom, opts?.customSlice);
  const [dataStart, dataEnd] = toSlice(data, opts?.dataSlice);
  const length = customEnd - customStart;
  checkSize(length, dataEnd - dataStart);

  for (let i = 0; i < custom.length; ++i)
    if (custom[i + customStart] !== data[i + dataStart])
      throw new Error(`binary data mismatch: ` +
        `layout value: ${custom}, offset: ${customStart}, data value: ${data}, offset: ${dataStart}`
      );
}

export function findIdLayoutPair(item: SwitchItem, data: any) {
  const id = data[item.idTag ?? "id"];
  return (item.layouts as readonly any[]).find(([idOrConversionId]) =>
    (Array.isArray(idOrConversionId) ? idOrConversionId[1] : idOrConversionId) == id
  )!;
}
