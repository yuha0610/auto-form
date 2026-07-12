import { test, expect } from "@playwright/test";
import { partitionByRowIntegrity } from "../src/lib/rowIntegrity.js";

interface Item {
  rowIndex: number;
  label: string;
}

test("全件一致していれば全てvalidになりmismatchedは空", () => {
  const items: Item[] = [
    { rowIndex: 2, label: "a" },
    { rowIndex: 3, label: "b" },
  ];
  const expected = new Map([
    [2, "UMITO"],
    [3, "HORIJUKU株式会社"],
  ]);
  const actual = new Map([
    [2, "UMITO"],
    [3, "HORIJUKU株式会社"],
  ]);

  const result = partitionByRowIntegrity(items, expected, actual);

  expect(result.valid).toEqual(items);
  expect(result.mismatched).toEqual([]);
});

test("1件だけ実際の企業名が異なる場合、その1件だけmismatchedに入り両方の名前を記録する", () => {
  const items: Item[] = [
    { rowIndex: 2, label: "a" },
    { rowIndex: 3, label: "b" },
  ];
  const expected = new Map([
    [2, "UMITO"],
    [3, "HORIJUKU株式会社"],
  ]);
  const actual = new Map([
    [2, "UMITO"],
    [3, "HORIJUKU株式会社になりすまし"],
  ]);

  const result = partitionByRowIntegrity(items, expected, actual);

  expect(result.valid).toEqual([{ rowIndex: 2, label: "a" }]);
  expect(result.mismatched).toEqual([
    {
      item: { rowIndex: 3, label: "b" },
      expected: "HORIJUKU株式会社",
      actual: "HORIJUKU株式会社になりすまし",
    },
  ]);
});

test("rowIndexに対応する行がactualNamesに存在しない(行削除)場合はmismatchedに入りactualはundefined", () => {
  const items: Item[] = [{ rowIndex: 5, label: "c" }];
  const expected = new Map([[5, "UMITO"]]);
  const actual = new Map<number, string>();

  const result = partitionByRowIntegrity(items, expected, actual);

  expect(result.valid).toEqual([]);
  expect(result.mismatched).toEqual([
    { item: { rowIndex: 5, label: "c" }, expected: "UMITO", actual: undefined },
  ]);
});

test("itemsが空配列の場合はvalidもmismatchedも空", () => {
  const result = partitionByRowIntegrity<Item>([], new Map(), new Map());

  expect(result.valid).toEqual([]);
  expect(result.mismatched).toEqual([]);
});
