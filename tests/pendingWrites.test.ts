import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
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
