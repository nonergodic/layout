import type {
  Layout,
  Item,
  DeriveType,
} from "./layout";
import {
  findIdLayoutPair,
  isBytesType,
  isItem,
  isFixedBytesConversion,
  checkItemSize,
} from "./utils";

export function calcSize<const L extends Layout>(layout: L, data: DeriveType<L>): number {
  const size = internalCalcSize(layout, data);
  if (size === null)
    throw new Error(
      `coding error: couldn't calculate layout size for layout ${layout} with data ${data}`
    );

  return size;
}

//no way to use overloading here:
// export function calcSize<const L extends Layout>(layout: L): number | null;
// export function calcSize<const L extends Layout>(layout: L, data: DeriveType<L>): number;
// export function calcSize<const L extends Layout>(
//   layout: L,
//   data?: DeriveType<L>
// ): number | null; //impl
//results in "instantiation too deep" error.
//
//Trying to pack everything into a single function definition means we either can't narrow the
//  return type correctly:
// export function calcSize<const L extends Layout>(
//   layout: L,
//   data: DeriveType<L>,
// ): number | null;
//or we have to make data overly permissive via:
// export function calcSize<
//   L extends Layout,
//   const D extends DeriveType<L> | undefined,
//  >(
//   layout: L,
//   data?: D, //data can now contain additional properties
// ): undefined extends D ? number | null : number;
//so we're stuck with having to use to separate names
export function calcStaticSize(layout: Layout): number | null {
  return internalCalcSize(layout);
}

// --- implementation ---

//stores the results of custom.from calls for bytes items to avoid duplicated effort upon
//  subsequent serialization
export function calcSizeForSerialization<const L extends Layout>(
  layout: L,
  data: DeriveType<L>
): [number, any[]] {
  const bytesConversions: any[] = [];
  const size = internalCalcSize(layout, data, bytesConversions);
  if (size === null)
    throw new Error(
      `coding error: couldn't calculate layout size for layout ${layout} with data ${data}`
    );

  return [size, bytesConversions];
}

function calcItemSize(item: Item, data: any, bytesConversions?: any[]): number | null {
  const storeInCache = (cachedFrom: any) => {
    if (bytesConversions !== undefined)
      bytesConversions.push(cachedFrom);

    return cachedFrom;
  };

  switch (item.binary) {
    case "int":
    case "uint":
      return item.size;
    case "bytes": {
      //items only have a size or a lengthSize, never both
      const lengthSize = ("lengthSize" in item) ? item.lengthSize | 0 : 0;

      if ("layout" in item) {
        const { custom } = item;
        const layoutSize = internalCalcSize(
          item.layout,
          custom === undefined
          ? data
          : typeof custom.from === "function"
          ? storeInCache(custom.from(data))
          : custom.from,
          bytesConversions
        );
        if (layoutSize === null)
          return ("size" in item ) ? item.size ?? null : null;

        return lengthSize + checkItemSize(item, layoutSize);
      }

      const { custom } = item;
      if (isBytesType(custom))
        return lengthSize + custom.length; //assumed to equal item.size if it exists

      if (isFixedBytesConversion(custom))
        return lengthSize + custom.from.length; //assumed to equal item.size if it exists

      if (custom === undefined)
        return data ? lengthSize + checkItemSize(item, data.length) : null;

      const cachedFrom = storeInCache(custom.from(data));
      return data !== undefined ? lengthSize + checkItemSize(item, cachedFrom.length) : null;
    }
    case "array": {
      const length = "length" in item ? item.length : undefined;
      if (data === undefined) {
        if (length !== undefined) {
          const layoutSize = internalCalcSize(item.layout, undefined, bytesConversions);
          if (layoutSize === null)
            return null;

          return length * layoutSize;
        }
        return null;
      }

      let size = 0;
      if (length !== undefined && length !== data.length)
        throw new Error(
          `array length mismatch: layout length: ${length}, data length: ${data.length}`
        );
      else if ("lengthSize" in item && item.lengthSize !== undefined)
        size += item.lengthSize;

      for (let i = 0; i < data.length; ++i) {
        const entrySize = internalCalcSize(item.layout, data[i], bytesConversions);
        if (entrySize === null)
          return null;

        size += entrySize;
      }

      return size;
    }
    case "switch": {
      if (data !== undefined) {
        const [_, layout] = findIdLayoutPair(item, data);
        const layoutSize = internalCalcSize(layout, data, bytesConversions);
        return layoutSize !== null ? item.idSize + layoutSize : null;
      }

      let size: number | null = null;
      for (const [_, layout] of item.layouts) {
        const layoutSize = internalCalcSize(layout, undefined, bytesConversions);
        if (size === null)
          size = layoutSize;
        else if (layoutSize !== size)
          return null;
      }
      return item.idSize + size!;
    }
  }
}

function internalCalcSize(layout: Layout, data?: any, bytesConversions?: any[]): number | null {
  if (isItem(layout))
    return calcItemSize(layout as Item, data, bytesConversions);

  let size = 0;
  for (const item of layout) {
    let itemData;
    if (data)
      if (!("omit" in item) || !item.omit) {
        if (!(item.name in data))
          throw new Error(`missing data for layout item: ${item.name}`);

        itemData = data[item.name];
      }

    const itemSize = calcItemSize(item, itemData, bytesConversions);
    if (itemSize === null) {
      if (data !== undefined)
        throw new Error(`coding error: couldn't calculate size for layout item: ${item.name}`);

      return null;
    }
    size += itemSize;
  }
  return size;
}
