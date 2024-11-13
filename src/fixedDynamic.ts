import type {
  Layout,
  ProperLayout,
  Item,
  NumItem,
  BytesItem,
  ArrayItem,
  SwitchItem,
  DeriveType,
  NumType,
  BytesType,
  LayoutObject,
  FixedConversion,
  CustomConversion,
} from "./layout";

import { isPrimitiveType, isItem, isFixedPrimitiveConversion } from "./utils";

export type FixedItemsOf<L extends Layout> = StartFilterItemsOf<L, true>;
export type DynamicItemsOf<L extends Layout> = StartFilterItemsOf<L, false>;

export const fixedItemsOf = <const L extends Layout>(layout: L) =>
  filterItemsOf(layout, true);

export const dynamicItemsOf = <const L extends Layout>(layout: L) =>
  filterItemsOf(layout, false);

export function addFixedValues<const L extends Layout>(
  layout: L,
  dynamicValues: DeriveType<DynamicItemsOf<L>>,
): DeriveType<L> {
  return internalAddFixedValues(layout, dynamicValues) as DeriveType<L>;
}

// --- implementation ---

type NonEmpty = readonly [unknown, ...unknown[]];

type IPLPair = readonly [any, ProperLayout];

type FilterItemsOfIPLPairs<ILA extends readonly IPLPair[], Fixed extends boolean> =
  ILA extends infer V extends readonly IPLPair[]
  ? V extends readonly [infer H extends IPLPair, ...infer T extends readonly IPLPair[]]
    ? FilterItemsOf<H[1], Fixed> extends infer P extends ProperLayout | void
      ? P extends NonEmpty
        ? [[H[0], P], ...FilterItemsOfIPLPairs<T, Fixed>]
        : FilterItemsOfIPLPairs<T, Fixed>
      : never
    : []
  : never;

type FilterLayoutOfItem<I extends { layout: Layout }, Fixed extends boolean> =
  FilterItemsOf<I["layout"], Fixed> extends infer L extends Item | NonEmpty
  ? { readonly [K in keyof I]: K extends "layout" ? L : I[K] }
  : void;

type FilterItem<II extends Item, Fixed extends boolean> =
  II extends infer I extends Item
  ? I extends NumItem
    ? I["custom"] extends NumType | FixedConversion<infer From extends NumType, infer To>
      ? Fixed extends true ? I : void
      : Fixed extends true ? void : I
    : I extends ArrayItem
    ? FilterLayoutOfItem<I, Fixed>
    : I extends BytesItem & { layout: Layout }
    ? I["custom"] extends { custom: FixedConversion<infer From extends LayoutObject, infer To>}
      ? Fixed extends true ? I : void
      : I extends { custom: CustomConversion<infer From extends LayoutObject, infer To>}
      ? Fixed extends true ? void : I
      : FilterLayoutOfItem<I, Fixed>
    : I extends BytesItem
    ? I["custom"] extends BytesType | FixedConversion<infer From extends BytesType, infer To>
      ? Fixed extends true ? I : void
      : Fixed extends true ? void : I
    : I extends SwitchItem
    ? { readonly [K in keyof I]:
        K extends "layouts" ? FilterItemsOfIPLPairs<I["layouts"], Fixed> : I[K]
      }
    : never
  : never;

type FilterItemsOf<L extends Layout, Fixed extends boolean> =
  L extends infer LI extends Item
  ? FilterItem<LI, Fixed>
  : L extends infer P extends ProperLayout
  ? P extends readonly [infer H extends Item, ...infer T extends ProperLayout]
    ? FilterItem<H, Fixed> extends infer NI
      ? NI extends Item
        // @ts-ignore TODO: figure out and fix this
        ? [NI, ...FilterItemsOf<T, Fixed>]
        : FilterItemsOf<T, Fixed>
      : never
    : []
  : never;

type StartFilterItemsOf<L extends Layout, Fixed extends boolean> =
  FilterItemsOf<L, Fixed> extends infer V extends Layout
  ? V
  : never;

function filterItem(item: Item, fixed: boolean): Item | null {
  switch (item.binary) {
    // @ts-ignore - fallthrough is intentional
    case "bytes": {
      if ("layout" in item) {
        const { custom } = item;
        if (custom === undefined) {
          const { layout } = item;
          if (isItem(layout))
            return filterItem(layout, fixed);

          const filteredItems = internalFilterItemsOfProperLayout(layout, fixed);
          return (filteredItems.length > 0) ? { ...item, layout: filteredItems } : null;
        }
        const isFixedItem = typeof custom.from !== "function";
        return (fixed && isFixedItem || !fixed && !isFixedItem) ? item : null;
      }
    }
    case "int":
    case "uint": {
      const { custom } = item;
      const isFixedItem = isPrimitiveType(custom) || isFixedPrimitiveConversion(custom);
      return (fixed && isFixedItem || !fixed && !isFixedItem) ? item : null;
    }
    case "array": {
      const filtered = internalFilterItemsOf(item.layout, fixed);
      return (filtered !== null) ? { ...item, layout: filtered } : null;
    }
    case "switch": {
      const filteredIdLayoutPairs = (item.layouts as readonly any[]).reduce(
        (acc: any, [idOrConversionId, idLayout]: any) => {
          const filteredItems = internalFilterItemsOfProperLayout(idLayout, fixed);
          return filteredItems.length > 0
            ? [...acc, [idOrConversionId, filteredItems]]
            : acc;
        },
        [] as any[]
      );
      return { ...item, layouts: filteredIdLayoutPairs };
    }
  }
}

function internalFilterItemsOfProperLayout(proper: ProperLayout, fixed: boolean): ProperLayout {
  return proper.reduce(
    (acc, item) => {
      const filtered = filterItem(item, fixed) as ProperLayout[number] | null;
      return filtered !== null ? [...acc, filtered] : acc;
    },
    [] as ProperLayout
  );
}

function internalFilterItemsOf(layout: Layout, fixed: boolean): any {
  return (Array.isArray(layout)
    ? internalFilterItemsOfProperLayout(layout, fixed)
    : filterItem(layout as Item, fixed)
   );
}

function filterItemsOf<L extends Layout, const Fixed extends boolean>(
  layout: L,
  fixed: Fixed
): FilterItemsOf<L, Fixed> {
  return internalFilterItemsOf(layout, fixed);
}

function internalAddFixedValuesItem(item: Item, dynamicValue: any): any {
  switch (item.binary) {
    // @ts-ignore - fallthrough is intentional
    case "bytes": {
      if ("layout" in item) {
        const { custom } = item;
        if (custom === undefined || typeof custom.from !== "function")
          return internalAddFixedValues(item.layout, custom ? custom.from : dynamicValue);

        return dynamicValue;
      }
    }
    case "int":
    case "uint": {
      const { custom } = item;
      return (item as {omit?: boolean})?.omit
        ? undefined
        : isPrimitiveType(custom)
        ? custom
        : isFixedPrimitiveConversion(custom)
        ? custom.to
        : dynamicValue;
    }
    case "array":
      return Array.isArray(dynamicValue)
        ? dynamicValue.map(element => internalAddFixedValues(item.layout, element))
        : undefined;
    case "switch": {
      const id = dynamicValue[item.idTag ?? "id"];
      const [_, idLayout] = (item.layouts as readonly IPLPair[]).find(([idOrConversionId]) =>
        (Array.isArray(idOrConversionId) ? idOrConversionId[1] : idOrConversionId) == id
      )!;
      return {
        [item.idTag ?? "id"]: id,
        ...internalAddFixedValues(idLayout, dynamicValue)
      };
    }
  }
}

function internalAddFixedValues(layout: Layout, dynamicValues: any): any {
  dynamicValues = dynamicValues ?? {};
  if (isItem(layout))
    return internalAddFixedValuesItem(layout as Item, dynamicValues);

  const ret = {} as any;
  for (const item of layout) {
    const fixedVals = internalAddFixedValuesItem(
      item,
      dynamicValues[item.name as keyof typeof dynamicValues] ?? {}
    );
    if (fixedVals !== undefined)
      ret[item.name] = fixedVals;
  }
  return ret;
}
