import type {
  Endianness,
  Layout,
  ProperLayout,
  Item,
  NumItem,
  BytesItem,
  ArrayItem,
  LengthPrefixed,
  SwitchItem,
} from "./layout";

import { isItem } from "./utils";

export function setEndianness<const L extends Layout, E extends Endianness>(
  layout: L,
  endianness: E,
): SetEndianness<L, E> {
  return isItem(layout)
    ? setItemEndianness(layout, endianness)
    : (layout as ProperLayout).map(item => setItemEndianness(item, endianness)) as any;
}

function setItemEndianness(item: Item, endianness: Endianness): any {
  switch (item.binary) {
    case "uint":
    case "int":
      return item?.size === 1 ? item : { ...item, endianness };
    case "bytes":
    case "array": {
      const layout = "layout" in item
        ? { layout: setEndianness(item.layout, endianness) }
        : {};
      const lengthEndianness = ("lengthSize" in item && item.lengthSize !== 1)
        ? { lengthEndianness: endianness }
        : {};
      return { ...item, ...layout, ...lengthEndianness };
    }
    case "switch": {
      const idEndianness = item.idSize !== 1 ? { idEndianness: endianness } : {};
      const layouts = item.layouts.map(([id, layout]) => [id, setEndianness(layout, endianness)]);
      return { ...item, ...idEndianness, layouts };
    }
  }
}

//reminder: this will not propagate through custom conversions that use layouts themselves!
export type SetEndianness<L extends Layout, E extends Endianness> = 
  Layout extends L
  ? unknown
  : L extends infer LI extends Item
  ? SetItemEndianness<LI, E>
  : L extends infer P extends ProperLayout
  ? SetProperLayoutEndianness<P, E>
  : never;

type SetItemEndianness<I extends Item, E extends Endianness> =
  I extends NumItem
  ? I["size"] extends 1
    ? I
    : SetProperty<I, "endianness", E>
  : I extends BytesItem | ArrayItem
  ? RecurseLayoutProperty<I, E> extends infer RI extends Item
    ? RI extends LengthPrefixed
      ? RI["lengthSize"] extends 1
        ? RI
        : SetProperty<RI, "lengthEndianness", E>
      : RI
    : never
  : I extends SwitchItem
  ? RecurseSwitchItem<I, E> extends infer RI extends SwitchItem
    ? RI["idSize"] extends 1
      ? RI
      : SetProperty<RI, "idEndianness", E>
    : never
  : never;

type SetProperLayoutEndianness<P extends ProperLayout, E extends Endianness> =
  P extends readonly [infer H extends Item, ...infer T extends ProperLayout]
  ? readonly [SetItemEndianness<H, E>, ...SetProperLayoutEndianness<T, E>]
  : readonly [];

type RecurseLayoutProperty<I extends Item, E extends Endianness> =
  "layout" extends keyof I
  ? I["layout"] extends Layout
    ? SetProperty<I, "layout", SetEndianness<I["layout"], E>>
    : never
  : I;

type RecurseSwitchItemImpl<SL extends readonly unknown[], E extends Endianness> =
  SL extends readonly [
    readonly [infer Id, infer P extends ProperLayout],
    ...infer T extends readonly unknown[]
  ]
  ? readonly [readonly [Id, SetProperLayoutEndianness<P, E>], ...RecurseSwitchItemImpl<T, E>]
  : readonly [];

type RecurseSwitchItem<I extends SwitchItem, E extends Endianness> =
  SetProperty<I, "layouts", RecurseSwitchItemImpl<I["layouts"], E>>;

//Omit<I, P> & { readonly [K in P]: E }
type SetProperty<I extends Item, P extends string, V> =
  { readonly [K in keyof I | P]: K extends P ? V : K extends keyof I ? I[K] : never } extends
    infer R extends Item
  ? R
  : never;
