export type {
  Item,
  NamedItem,
  ProperLayout,
  Layout,
  DeriveType,
  FixedConversion,
  CustomConversion,
  Endianness,
  NumberSize,
  NumSizeToPrimitive,
  //the following types are exported because they are leaked and can give rise to error ts(4023)
  //  for types from external modules that cannot be named
  UintItem,
  IntItem,
  BytesItem,
  ArrayItem,
  SwitchItem,
  ItemBase,
  NumItem,
  FixedPrimitiveNum,
  OptionalToFromNum,
  LengthPrefixed,
  FixedLengthArray,
  LengthPrefixedArray,
  RemainderArray,
  FixedPrimitiveBytes,
  FlexPureBytes,
  FlexLayoutBytes,
  ManualSizePureBytes,
  LengthPrefixedPureBytes,
  ManualSizeLayoutBytes,
  LengthPrefixedLayoutBytes,
} from "./layout";
export { numberMaxSize } from "./layout";
export { serialize } from "./serialize";
export { type DeserializeReturn, deserialize } from "./deserialize";
export * from "./fixedDynamic";
export * from "./discriminate";
export { calcSize, calcStaticSize } from "./size";
export * from "./items";
export * from "./setEndianness";
