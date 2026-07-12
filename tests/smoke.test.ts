import { test, expect } from "@playwright/test";

test("2 + 2 は 4 になる(セットアップ確認用)", () => {
  expect(2 + 2).toBe(4);
});
