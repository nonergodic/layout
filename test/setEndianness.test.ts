import type { Item } from "../src/layout";
import { setEndianness } from "../src/setEndianness";
import { customizableBytes, optionItem, enumItem, bitsetItem } from "../src/items";

describe("setEndianness", () => {
  const endianness = "little";
  const lengthEndianness = endianness;
  const idEndianness = endianness;

  const uintItem = { binary: "uint", size: 2 } as const satisfies Item;
  const resultUintItem = { ...uintItem, endianness } as const satisfies Item;

  const intItem = { binary: "int", size: 2 } as const satisfies Item;
  const resultIntItem = { ...intItem, endianness } as const satisfies Item;

  const lengthSizedArrayItem = {
    binary: "array",
    lengthSize: 2,
    layout: [
      { name: "uint", ...uintItem },
      { name: "int",  ...intItem  },
    ]
  } as const;
  const resultLengthSizedArrayItem = {
    ...lengthSizedArrayItem,
    lengthEndianness,
    layout: [
      { name: "uint", ...resultUintItem },
      { name: "int",  ...resultIntItem  }
    ]
  } as const satisfies Item;

  const customBytesItem = customizableBytes({ lengthSize: 2 }, lengthSizedArrayItem);
  const resultCustomizableBytesItem =
    customizableBytes({ lengthSize: 2, lengthEndianness }, resultLengthSizedArrayItem);
  
  //jest compares functions by reference, so we need to do some ugly acrobatics here
  const optItem = optionItem(lengthSizedArrayItem);
  const resultOptItem = {...optItem, layout: { ...optItem.layout, layouts: [
    optItem.layout.layouts[0],
    [ optItem.layout.layouts[1][0],
      [{ ...optItem.layout.layouts[1][1][0], layout: resultLengthSizedArrayItem }]
    ],
  ]}} as const satisfies Item;

  const enItem = enumItem([["a", 1], ["b", 2]], { size: 2 });
  const resultEnItem = { ...enItem, endianness } as const;

  const bitsItem = bitsetItem(["zero", "one", "two", "", "", "", "", "seven", "eight"]);
  const resultBitsItem = { ...bitsItem, endianness } as const satisfies Item;

  const complexSwitchLayout = {
    binary: "switch",
    idSize: 2,
    idTag: "type",
    layouts: [
      [[1, "nums"], [
        { name: "uint", ...uintItem },
        { name: "int",  ...intItem  },
      ]],
      [[3, "lens"], [
        { name: "lenSize", ...lengthSizedArrayItem },
        { name: "custom",  ...customBytesItem      },
        { name: "option",  ...optItem              },
      ]],
      [[6, "misc"], [
        { name: "enum",   ...enItem   },
        { name: "bitset", ...bitsItem },
      ]],
    ]
  } as const;
  const resultComplexSwitchLayout = {
    ...complexSwitchLayout,
    idEndianness,
    layouts: [
      [[1, "nums"], [
        { name: "uint", ...resultUintItem },
        { name: "int",  ...resultIntItem  },
      ]],
      [[3, "lens"], [
        { name: "lenSize", ...resultLengthSizedArrayItem  },
        { name: "custom",  ...resultCustomizableBytesItem },
        { name: "option",  ...resultOptItem               },
      ]],
      [[6, "misc"], [
        { name: "enum",   ...resultEnItem   },
        { name: "bitset", ...resultBitsItem },
      ]],
    ]
  } as const satisfies Item;

  test("should set endianness for uint", () => {
    const res = setEndianness(uintItem, endianness);
    expect(res).toEqual(resultUintItem);
  });

  test("should set endianness for int", () => {
    const res = setEndianness(intItem, endianness);
    expect(res).toEqual(resultIntItem);
  });

  test("should set endianness for array", () => {
    const res = setEndianness(lengthSizedArrayItem, endianness);
    expect(res).toEqual(resultLengthSizedArrayItem);
  });

  test("should set endianness for customizable bytes", () => {
    const res = setEndianness(customBytesItem, endianness);
    expect(res).toEqual(resultCustomizableBytesItem);
  });

  test("should set endianness for option", () => {
    const res = setEndianness(optItem, endianness);
    expect(res).toEqual(resultOptItem);
  });

  test("should set endianness for enum", () => {
    const res = setEndianness(enItem, endianness);
    expect(res).toEqual(resultEnItem);
  });

  test("should set endianness for bitset", () => {
    const res = setEndianness(bitsItem, endianness);
    expect(res).toEqual(resultBitsItem);
  });

  test("should set endianness for complex switch", () => {
    const res = setEndianness(complexSwitchLayout, endianness);
    expect(res).toEqual(resultComplexSwitchLayout);
  });
});
