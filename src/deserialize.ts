import type {
  Endianness,
  Layout,
  Item,
  DeriveType,
  CustomConversion,
  NumSizeToPrimitive,
  NumType,
  BytesType,
} from "./layout";
import { defaultEndianness, numberMaxSize } from "./layout";

import {
  isNumType,
  isBytesType,
  isFixedBytesConversion,
  checkBytesTypeEqual,
  checkNumEquals,
} from "./utils";
import { getCachedSerializedFrom } from "./serialize";

type DeserializeReturn<L extends Layout, B extends boolean> =
  B extends true ? DeriveType<L> : readonly [DeriveType<L>, number];

export function deserialize<const L extends Layout, const B extends boolean = true>(
  layout: L,
  bytes: BytesType,
  consumeAll?: B,
): DeserializeReturn<L, B> {
  const boolConsumeAll = consumeAll ?? true;
  const encoded = {
    bytes,
    offset: 0,
    end: bytes.length,
  };
  const decoded = internalDeserialize(layout, encoded);

  if (boolConsumeAll && encoded.offset !== encoded.end)
    throw new Error(`encoded data is longer than expected: ${encoded.end} > ${encoded.offset}`);

  return (boolConsumeAll ? decoded : [decoded, encoded.offset]) as DeserializeReturn<L, B>;
}

// --- implementation ---

type BytesChunk = {
  bytes: BytesType,
  offset: number,
  end: number,
};

function updateOffset(encoded: BytesChunk, size: number) {
  const newOffset = encoded.offset + size;
  if (newOffset > encoded.end)
    throw new Error(`chunk is shorter than expected: ${encoded.end} < ${newOffset}`);

  encoded.offset = newOffset;
}

function internalDeserialize(layout: Layout, encoded: BytesChunk): any {
  if (!Array.isArray(layout))
    return deserializeItem(layout as Item, encoded);

  let decoded = {} as any;
  for (const item of layout)
    try {
      ((item as any).omit ? {} : decoded)[item.name] = deserializeItem(item, encoded);
    }
    catch (e) {
      (e as Error).message = `when deserializing item '${item.name}': ${(e as Error).message}`;
      throw e;
    }

  return decoded;
}

function deserializeNum<S extends number>(
  encoded: BytesChunk,
  size: S,
  endianness: Endianness = defaultEndianness,
  signed: boolean = false,
) {
  let val = 0n;
  for (let i = 0; i < size; ++i)
    val |= BigInt(encoded.bytes[encoded.offset + i]!)
        << BigInt(8 * (endianness === "big" ? size - i - 1 : i));

  //check sign bit if value is indeed signed and adjust accordingly
  if (signed && (encoded.bytes[encoded.offset + (endianness === "big" ? 0 : size - 1)]! & 0x80))
    val -= 1n << BigInt(8 * size);

  updateOffset(encoded, size);

  return ((size > numberMaxSize) ? val : Number(val)) as NumSizeToPrimitive<S>;
}

function deserializeItem(item: Item, encoded: BytesChunk): any {
  switch (item.binary) {
    case "int":
    case "uint": {
      const value = deserializeNum(encoded, item.size, item.endianness, item.binary === "int");

      const { custom } = item;
      if (isNumType(custom)) {
        checkNumEquals(custom, value);
        return custom;
      }
      if (isNumType(custom?.from)) {
        checkNumEquals(custom!.from, value);
        return custom!.to;
      }

      //narrowing to CustomConversion<UintType, any> is a bit hacky here, since the true type
      //  would be CustomConversion<number, any> | CustomConversion<bigint, any>, but then we'd
      //  have to further tease that apart still for no real gain...
      return custom !== undefined ? (custom as CustomConversion<NumType, any>).to(value) : value;
    }
    case "bytes": {
      const expectedSize = ("lengthSize" in item && item.lengthSize !== undefined)
        ? deserializeNum(encoded, item.lengthSize, item.lengthEndianness)
        : (item as {size?: number})?.size;

      if ("layout" in item) { //handle layout conversions
        const { custom } = item;
        const offset = encoded.offset;
        let layoutData;
        if (expectedSize === undefined)
          layoutData = internalDeserialize(item.layout, encoded);
        else {
          const subChunk = {...encoded, end: encoded.offset + expectedSize};
          updateOffset(encoded, expectedSize);
          layoutData = internalDeserialize(item.layout, subChunk);
          if (subChunk.offset !== subChunk.end)
            throw new Error(
              `read less data than expected: ${subChunk.offset - encoded.offset} < ${expectedSize}`
            );
        }

        if (custom !== undefined) {
          if (typeof custom.from !== "function") {
            checkBytesTypeEqual(
              getCachedSerializedFrom(item as any),
              encoded.bytes,
              {dataSlize: [offset, encoded.offset]}
            );
            return custom.to;
          }
          return custom.to(layoutData);
        }

        return layoutData;
      }

      const { custom } = item;
      { //handle fixed conversions
        let fixedFrom;
        let fixedTo;
        if (isBytesType(custom))
          fixedFrom = custom;
        else if (isFixedBytesConversion(custom)) {
          fixedFrom = custom.from;
          fixedTo = custom.to;
        }
        if (fixedFrom !== undefined) {
          const size = expectedSize ?? fixedFrom.length;
          const value = encoded.bytes.subarray(encoded.offset, encoded.offset + size);
          checkBytesTypeEqual(fixedFrom, value);
          updateOffset(encoded, size);
          return fixedTo ?? fixedFrom;
        }
      }

      //handle no or custom conversions
      const start = encoded.offset;
      const end = (expectedSize !== undefined) ? encoded.offset + expectedSize : encoded.end;
      updateOffset(encoded, end - start);

      const value = encoded.bytes.subarray(start, end);
      return custom !== undefined ? (custom as CustomConversion<BytesType, any>).to(value) : value;
    }
    case "array": {
      let ret = [] as any[];
      const { layout } = item;
      const deserializeArrayItem = () => {
        const deserializedItem = internalDeserialize(layout, encoded);
        ret.push(deserializedItem);
      }

      let length: number | null = null;
      if ("length" in item && item.length !== undefined)
        length = item.length;
      else if ("lengthSize" in item && item.lengthSize !== undefined)
        length = deserializeNum(encoded, item.lengthSize, item.lengthEndianness);

      if (length !== null)
        for (let i = 0; i < length; ++i)
          deserializeArrayItem();
      else
        while (encoded.offset < encoded.end)
          deserializeArrayItem();

      return ret;
    }
    case "switch": {
      const id = deserializeNum(encoded, item.idSize, item.idEndianness);
      const {layouts} = item;
      if (layouts.length === 0)
        throw new Error(`switch item has no layouts`);

      const hasPlainIds = typeof layouts[0]![0] === "number";
      const pair = (layouts as readonly any[]).find(([idOrConversionId]) =>
        hasPlainIds ? idOrConversionId === id : (idOrConversionId)[0] === id);

      if (pair === undefined)
        throw new Error(`unknown id value: ${id}`);

      const [idOrConversionId, idLayout] = pair;
      const decoded = internalDeserialize(idLayout, encoded);
      return {
        [item.idTag ?? "id"]: hasPlainIds ? id : (idOrConversionId as any)[1],
        ...decoded
      };
    }
  }
}
