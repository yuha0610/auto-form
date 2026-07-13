import { test, expect } from "@playwright/test";
import { buildNotifyCommand } from "../src/lib/notify.js";

test("buildNotifyCommand は件数・タイトル・サウンドを含む通知コマンドを返す", () => {
  const command = buildNotifyCommand(5);
  expect(command).toContain("5件のタブを開きました。確認・送信をお願いします。");
  expect(command).toContain("auto-form");
  expect(command).toContain("Glass");
});

test("buildNotifyCommand は件数が変わると文言も変わる", () => {
  expect(buildNotifyCommand(1)).toContain("1件のタブを開きました");
  expect(buildNotifyCommand(20)).toContain("20件のタブを開きました");
});
