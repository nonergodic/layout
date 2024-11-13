import type {
  Endianness,
  Layout,
  Item,
  DeriveType,
  CustomConversion,
  NumType,
  BytesType,
  FixedConversion,
  LayoutObject,
  ItemBase
} from "./layout";
import {
  defaultEndianness,
  numberMaxSize,
} from "./layout";
import { calcSizeForSerialization } from "./size";
import {
  checkItemSize,
  checkBytesTypeEqual,
  checkNumEquals,
  findIdLayoutPair,
  isFixedBytesConversion,
  isItem,
  isNumType,
  isBytesType,
} from "./utils";

type Cursor = {
  bytes: BytesType;
  offset: number;
};

const cursorWrite = (cursor: Cursor, bytes: BytesType) => {
  cursor.bytes.set(bytes, cursor.offset);
  cursor.offset += bytes.length;
}

type BytesConversionQueue = {
  bytesConversions: any[],
  position: number,
}

const bcqGetNext = (bcq: BytesConversionQueue) => bcq.bytesConversions[bcq.position++];

//returns a BytesType if no encoded data is provided, otherwise returns the number of bytes written
//  to the provided Uint8Array. Callers should use Uint8Array.subarray if they want to serialize
//  in place of a larger, pre-allocated Uint8Array.
export function serialize<
  const L extends Layout,
  E extends BytesType | undefined = undefined
>(layout: L, data: DeriveType<L>, encoded?: E) {
  const [size, bytesConversions] = calcSizeForSerialization(layout, data);
  const cursor = { bytes: encoded ?? new Uint8Array(size), offset: 0 };
  internalSerialize(layout, data, cursor, {bytesConversions, position: 0});
  if (!encoded && cursor.offset !== cursor.bytes.length)
    throw new Error(
      `encoded data is shorter than expected: ${cursor.bytes.length} > ${cursor.offset}`
    );

  return (encoded ? cursor.offset : cursor.bytes) as E extends undefined ? BytesType : number;
}

//see numberMaxSize comment in layout.ts
const maxAllowedNumberVal = 2 ** (numberMaxSize * 8);

export function serializeNum(
  val: NumType,
  size: number,
  cursor: Cursor,
  endianness: Endianness = defaultEndianness,
  signed: boolean = false,
) {
  if (!signed && val < 0)
    throw new Error(`Value ${val} is negative but unsigned`);

  if (typeof val === "number") {
    if (!Number.isInteger(val))
      throw new Error(`Value ${val} is not an integer`);

    if (size > numberMaxSize) {
      if (val >= maxAllowedNumberVal)
        throw new Error(`Value ${val} is too large to be safely converted into an integer`);

      if (signed && val < -maxAllowedNumberVal)
        throw new Error(`Value ${val} is too small to be safely converted into an integer`);
    }
  }

  const bound = 2n ** BigInt(size * 8 - (signed ? 1 : 0));
  if (val >= bound)
    throw new Error(`Value ${val} is too large for ${size} bytes`);

  if (signed && val < -bound)
    throw new Error(`Value ${val} is too small for ${size} bytes`);

  //correctly handles both signed and unsigned values
  for (let i = 0; i < size; ++i)
    cursor.bytes[cursor.offset + i] =
      Number((BigInt(val) >> BigInt(8 * (endianness === "big" ? size - i - 1 : i)) & 0xffn));

  cursor.offset += size;
}

function internalSerialize(layout: Layout, data: any, cursor: Cursor, bcq: BytesConversionQueue) {
  if (isItem(layout))
    serializeItem(layout as Item, data, cursor, bcq);
  else
    for (const item of layout)
      try {
        serializeItem(item, data[item.name], cursor, bcq);
      }
      catch (e: any) {
        e.message = `when serializing item '${item.name}': ${e.message}`;
        throw e;
      }
}

function serializeItem(item: Item, data: any, cursor: Cursor, bcq: BytesConversionQueue) {
  switch (item.binary) {
    case "int":
    case "uint": {
      const value = (() => {
        if (isNumType(item.custom)) {
          if (!("omit" in item && item.omit))
            checkNumEquals(item.custom, data);
          return item.custom;
        }

        if (isNumType(item?.custom?.from))
          //no proper way to deeply check equality of item.custom.to and data in JS
          return item!.custom!.from;

        type narrowedCustom = CustomConversion<number, any> | CustomConversion<bigint, any>;
        return item.custom !== undefined ? (item.custom as narrowedCustom).from(data) : data;
      })();

      serializeNum(value, item.size, cursor, item.endianness, item.binary === "int");
      break;
    }
    case "bytes": {
      const offset = cursor.offset;
      if ("lengthSize" in item && item.lengthSize !== undefined)
        cursor.offset += item.lengthSize;

      if ("layout" in item) {
        const { custom } = item;
        let layoutData;
        if (custom === undefined)
          layoutData = data;
        else if (typeof custom.from !== "function")
          layoutData = custom.from;
        else
          layoutData = bcqGetNext(bcq);

        internalSerialize(item.layout, layoutData, cursor, bcq);
      }
      else {
        const { custom } = item;
        if (isBytesType(custom)) {
          if (!("omit" in item && item.omit))
            checkBytesTypeEqual(custom, data);

          cursorWrite(cursor, custom);
        }
        else if (isFixedBytesConversion(custom))
          //no proper way to deeply check equality of custom.to and data
          cursorWrite(cursor, custom.from);
        else
          cursorWrite(cursor, custom !== undefined ? bcqGetNext(bcq) : data);
      }

      if ("lengthSize" in item && item.lengthSize !== undefined) {
        const itemSize = cursor.offset - offset - item.lengthSize;
        const curOffset = cursor.offset;
        cursor.offset = offset;
        serializeNum(itemSize, item.lengthSize, cursor, item.lengthEndianness);
        cursor.offset = curOffset;
      }
      else
        checkItemSize(item, cursor.offset - offset);

      break;
    }
    case "array": {
      if ("length" in item && item.length !== data.length)
        throw new Error(
          `array length mismatch: layout length: ${item.length}, data length: ${data.length}`
        );

      if ("lengthSize" in item && item.lengthSize !== undefined)
        serializeNum(data.length, item.lengthSize, cursor, item.lengthEndianness);

      for (let i = 0; i < data.length; ++i)
        internalSerialize(item.layout, data[i], cursor, bcq);

      break;
    }
    case "switch": {
      const [idOrConversionId, layout] = findIdLayoutPair(item, data);
      const idNum = (Array.isArray(idOrConversionId) ? idOrConversionId[0] : idOrConversionId);
      serializeNum(idNum, item.idSize, cursor, item.idEndianness);
      internalSerialize(layout, data, cursor, bcq);
      break;
    }
  }
};

//slightly hacky, but the only way to ensure that we are actually deserializing the
//  right data without having to re-serialize the layout every time
export function getCachedSerializedFrom(
  item: ItemBase<"bytes"> & {layout: Layout; custom: FixedConversion<LayoutObject, any>}
) {
  const custom =
    item.custom as FixedConversion<LayoutObject, any> & {cachedSerializedFrom?: BytesType};
  if (!("cachedSerializedFrom" in custom)) {
    custom.cachedSerializedFrom = serialize(item.layout, custom.from);
    if ("size" in item &&
        item.size !== undefined &&
        item.size !== custom.cachedSerializedFrom.length
      )
      throw new Error(
        `Layout specification error: custom.from does not serialize to specified size`
      );
  }
  return custom.cachedSerializedFrom!;
}
