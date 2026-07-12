import { test, expect } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  savePendingWrites,
  loadPendingWrites,
  deletePendingWrite,
} from "../src/lib/pendingWrites.js";

test("savePendingWrites/loadPendingWrites: 保存した内容を読み戻せる", async () => {
  const dir = await mkdtemp(join(tmpdir(), "auto-form-pending-"));
  try {
    const writes = [{ rowIndex: 3, columnName: "備考", value: "テスト" }];
    const path = await savePendingWrites(dir, writes);

    const loaded = await loadPendingWrites(dir);
    expect(loaded).toEqual([{ path, writes }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("deletePendingWrite: 削除後は読み込まれない", async () => {
  const dir = await mkdtemp(join(tmpdir(), "auto-form-pending-"));
  try {
    const writes = [{ rowIndex: 1, columnName: "備考", value: "x" }];
    const path = await savePendingWrites(dir, writes);
    await deletePendingWrite(path);

    const loaded = await loadPendingWrites(dir);
    expect(loaded).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadPendingWrites: 破損したJSONファイルをスキップして他のファイルを読み込む", async () => {
  const dir = await mkdtemp(join(tmpdir(), "auto-form-pending-"));
  try {
    // 有効なファイルを保存
    const writes = [{ rowIndex: 2, columnName: "名前", value: "テスト" }];
    const validPath = await savePendingWrites(dir, writes);

    // 破損したJSONファイルを直接作成
    const corruptPath = join(dir, "pending-corrupt.json");
    await writeFile(corruptPath, "{ not valid json", "utf-8");

    // 読み込み結果は有効なファイルのみを含む
    const loaded = await loadPendingWrites(dir);
    expect(loaded).toEqual([{ path: validPath, writes }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
