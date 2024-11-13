export type NumType = number | bigint;
export type BytesType = Uint8Array;
export type PrimitiveType = NumType | BytesType;

//used wherever an object is expected that sprung from the DeriveType type defined below
export type LayoutObject = { readonly [key: string]: any };

export const binaryLiterals = ["int", "uint", "bytes", "array", "switch"] as const;
export type BinaryLiterals = typeof binaryLiterals[number];
export type Endianness = "little" | "big";
export const defaultEndianness = "big";

export const numberMaxSize = 6; //Math.log2(Number.MAX_SAFE_INTEGER) / 8 = 6.625;
export type NumberSize = 1 | 2 | 3 | 4 | 5 | 6;

export type NumSizeToPrimitive<Size extends number> =
  Size extends NumberSize
  ? number
  : Size & NumberSize extends never
  ? bigint
  : number | bigint;

export type FixedConversion<FromType extends PrimitiveType | LayoutObject, ToType> = {
  readonly to: ToType,
  readonly from: FromType,
};

export type CustomConversion<FromType extends PrimitiveType | LayoutObject, ToType> = {
  readonly to: (val: FromType) => ToType,
  readonly from: (val: ToType) => FromType,
};

export interface ItemBase<BL extends BinaryLiterals> {
  readonly binary: BL,
};

interface FixedOmittableCustom<T extends PrimitiveType> {
  custom: T,
  omit?: boolean
};

//length size: number of bytes used to encode the preceeding length field which in turn
//  holds either the number of bytes (for bytes) or elements (for array)
export interface LengthPrefixed {
  readonly lengthSize: NumberSize,
  readonly lengthEndianness?: Endianness, //see defaultEndianness
  // //restricts the datarange of lengthSize to a maximum value to prevent out of memory
  // //  attacks/issues
  // readonly maxLength?: number,
}

//size: number of bytes used to encode the item
interface NumItemBase<T extends NumType, Signed extends Boolean>
    extends ItemBase<Signed extends true ? "int" : "uint"> {
  size: T extends bigint ? number : NumberSize,
  endianness?: Endianness, //see defaultEndianness
};

export interface FixedPrimitiveNum<
  T extends NumType,
  Signed extends Boolean
> extends NumItemBase<T, Signed>, FixedOmittableCustom<T> {};

export interface OptionalToFromNum<
  T extends NumType,
  Signed extends Boolean
> extends NumItemBase<T, Signed> {
  custom?: FixedConversion<T, any> | CustomConversion<T, any>
};

export interface FixedPrimitiveBytes
  extends ItemBase<"bytes">, FixedOmittableCustom<BytesType> {};
export interface FlexPureBytes extends ItemBase<"bytes"> {
  readonly custom?: BytesType | FixedConversion<BytesType, any> | CustomConversion<BytesType, any>,
};

export interface FlexLayoutBytes extends ItemBase<"bytes"> {
  readonly custom?: FixedConversion<LayoutObject, any> | CustomConversion<LayoutObject, any>,
  readonly layout: Layout,
}

export interface ManualSizePureBytes extends FlexPureBytes {
  readonly size: number,
};

export interface LengthPrefixedPureBytes extends FlexPureBytes, LengthPrefixed {};

export interface ManualSizeLayoutBytes extends FlexLayoutBytes {
  readonly size: number,
};

export interface LengthPrefixedLayoutBytes extends FlexLayoutBytes, LengthPrefixed {};

interface ArrayItemBase extends ItemBase<"array"> {
  readonly layout: Layout,
};

export interface FixedLengthArray extends ArrayItemBase {
  readonly length: number,
};

export interface LengthPrefixedArray extends ArrayItemBase, LengthPrefixed {};

//consumes the rest of the data on deserialization
export interface RemainderArray extends ArrayItemBase {};

type PlainId = number;
type ConversionId = readonly [number, unknown];
type IdProperLayoutPair<
  Id extends PlainId | ConversionId,
  P extends ProperLayout = ProperLayout
> = readonly [Id, P];
type IdProperLayoutPairs =
  readonly IdProperLayoutPair<PlainId>[] |
  readonly IdProperLayoutPair<ConversionId>[];
type DistributiveAtLeast1<T> = T extends any ? readonly [T, ...T[]] : never;
export interface SwitchItem extends ItemBase<"switch"> {
  readonly idSize: NumberSize,
  readonly idEndianness?: Endianness, //see defaultEndianness
  readonly idTag?: string,
  readonly layouts:
    DistributiveAtLeast1<IdProperLayoutPair<PlainId> | IdProperLayoutPair<ConversionId>>,
}

export type NumItem<Signed extends boolean = boolean> =
  //force distribution over union
  Signed extends infer S extends boolean
  ? FixedPrimitiveNum<number, S> |
    OptionalToFromNum<number, S> |
    FixedPrimitiveNum<bigint, S> |
    OptionalToFromNum<bigint, S>
  : never;

export type UintItem = NumItem<false>;
export type IntItem = NumItem<true>;
export type BytesItem =
  FixedPrimitiveBytes |
  FlexPureBytes |
  ManualSizePureBytes |
  LengthPrefixedPureBytes |
  FlexLayoutBytes |
  ManualSizeLayoutBytes |
  LengthPrefixedLayoutBytes;
export type ArrayItem = FixedLengthArray | LengthPrefixedArray | RemainderArray;
export type Item = NumItem | BytesItem | ArrayItem | SwitchItem;
type NamedItem = Item & { readonly name: string };
export type ProperLayout = readonly NamedItem[];
export type Layout = Item | ProperLayout;

type NameOrOmitted<T extends { name: string }> = T extends {omit: true} ? never : T["name"];

export type DeriveType<L extends Layout> =
  Layout extends L
  ? unknown
  : L extends infer LI extends Item
  ? ItemToType<LI>
  : L extends infer P extends ProperLayout
  ? { readonly [I in P[number] as NameOrOmitted<I>]: ItemToType<I> }
  : never;

type ItemToType<II extends Item> =
  II extends infer I extends Item
  ? I extends NumItem
    ? NumItemToType<I>
    : I extends BytesItem
    ? BytesItemToType<I>
    : I extends ArrayItem
    ? ArrayItemToType<I>
    : I extends SwitchItem
    ? SwitchItemToType<I>
    : never
  : never;

//---NumItem---
type NumItemToType<I extends NumItem> =
  //we must infer FromType here to make sure we "hit" the correct type of the conversion
  I["custom"] extends CustomConversion<infer From extends NumType, infer To>
  ? To
  : I["custom"] extends FixedConversion<infer From extends NumType, infer To>
  ? To
  : I["custom"] extends undefined
  ? NumSizeToPrimitive<I["size"]>
  : I["custom"] extends NumType
  ? I["custom"]
  : NumSizeToPrimitive<I["size"]>;

//---BytesItem---
type BytesItemToType<I extends BytesItem> =
  I extends { layout: Layout }
  ? I["custom"] extends CustomConversion<infer From extends LayoutObject, infer To>
    ? To
    : I["custom"] extends FixedConversion<infer From extends LayoutObject, infer To>
    ? To
    : DeriveType<I["layout"]>
  : I["custom"] extends CustomConversion<BytesType, infer To>
  ? To
  : I["custom"] extends FixedConversion<BytesType, infer To>
  ? To
  : BytesType;

//---ArrayItem---
type TupleWithLength<T, L extends number, A extends T[] = []> =
  A["length"] extends L
  ? A
  : TupleWithLength<T, L, [...A, T]>;

type ArrayItemToType<I extends ArrayItem> =
  DeriveType<I["layout"]> extends infer DT
  ? I extends { length: infer AL extends number }
    ? number extends AL
      ? readonly DT[]
      : Readonly<TupleWithLength<DT, AL>>
    : readonly DT[]
  : never;

//---SwitchItem---
type MaybeConvert<Id extends PlainId | ConversionId> =
  Id extends readonly [number, infer Converted] ? Converted : Id;

type IdLayoutPairsToTypeUnion<A extends IdProperLayoutPairs, IdTag extends string> =
  A extends infer V extends IdProperLayoutPairs
  ? V extends readonly [infer Head,...infer Tail extends IdProperLayoutPairs]
    ? Head extends IdProperLayoutPair<infer MaybeConversionId, infer P extends ProperLayout>
      ? MaybeConvert<MaybeConversionId> extends infer Id
        ? DeriveType<P> extends infer DT extends LayoutObject
          ? { readonly [K in IdTag | keyof DT]: K extends keyof DT ? DT[K] : Id }
            | IdLayoutPairsToTypeUnion<Tail, IdTag>
          : never
        : never
      : never
    : never
  : never;

type SwitchItemToType<I extends SwitchItem> =
  IdLayoutPairsToTypeUnion<
    I["layouts"],
    I["idTag"] extends infer ID extends string
    ? ID extends undefined
      ? "id"
      : ID
    : never
  >;
