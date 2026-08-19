import { test, expect } from "@playwright/test";
import { matchPastedUrls } from "../src/lib/urlMatch.js";

const candidates = [
  { key: 10, urls: ["https://alpha.example.com/contact"] },
  { key: 20, urls: ["https://beta.example.jp/inquiry/"] },
];

test("matchPastedUrls: 完全一致するURLを突き合わせる", () => {
  const result = matchPastedUrls("https://alpha.example.com/contact", candidates);
  expect(result.matchedKeys).toEqual([10]);
  expect(result.unmatched).toEqual([]);
});

test("matchPastedUrls: 末尾スラッシュや大文字小文字の違いを無視する", () => {
  const result = matchPastedUrls("HTTPS://Alpha.Example.com/contact/", candidates);
  expect(result.matchedKeys).toEqual([10]);
});

test("matchPastedUrls: パスが違ってもホストが同じなら同じ企業として扱う", () => {
  // 確認中にサイト内を移動してURLが変わっていても拾えるようにする
  const result = matchPastedUrls("https://alpha.example.com/contact/thanks?id=1", candidates);
  expect(result.matchedKeys).toEqual([10]);
});

test("matchPastedUrls: www有無の違いを無視する", () => {
  const result = matchPastedUrls("https://www.alpha.example.com/", candidates);
  expect(result.matchedKeys).toEqual([10]);
});

test("matchPastedUrls: カンマ区切りで複数まとめて指定できる", () => {
  const result = matchPastedUrls(
    "https://alpha.example.com/contact, https://beta.example.jp/inquiry/",
    candidates,
  );
  expect(result.matchedKeys).toEqual([10, 20]);
  expect(result.unmatched).toEqual([]);
});

test("matchPastedUrls: 改行や空白区切りでも複数指定できる", () => {
  const result = matchPastedUrls(
    "https://alpha.example.com/contact\nhttps://beta.example.jp/inquiry/",
    candidates,
  );
  expect(result.matchedKeys).toEqual([10, 20]);
});

test("matchPastedUrls: どれにも一致しないURLはunmatchedとして返す(黙って捨てない)", () => {
  const result = matchPastedUrls("https://unknown.example.org/contact", candidates);
  expect(result.matchedKeys).toEqual([]);
  expect(result.unmatched).toEqual(["https://unknown.example.org/contact"]);
});

test("matchPastedUrls: 空入力では何も一致せず、unmatchedも空", () => {
  expect(matchPastedUrls("", candidates)).toEqual({ matchedKeys: [], unmatched: [] });
  expect(matchPastedUrls("   \n  ", candidates)).toEqual({ matchedKeys: [], unmatched: [] });
});

test("matchPastedUrls: 同じ企業を重複して貼ってもキーは1つだけ返す", () => {
  const result = matchPastedUrls(
    "https://alpha.example.com/contact, https://alpha.example.com/other",
    candidates,
  );
  expect(result.matchedKeys).toEqual([10]);
});

test("matchPastedUrls: URLとして解釈できない文字列もunmatchedに入れる", () => {
  const result = matchPastedUrls("あああ", candidates);
  expect(result.matchedKeys).toEqual([]);
  expect(result.unmatched).toEqual(["あああ"]);
});

test("matchPastedUrls: ホストが同じ候補が複数あるときは完全一致を優先する", () => {
  const sameHost = [
    { key: 1, urls: ["https://shared.example.com/a"] },
    { key: 2, urls: ["https://shared.example.com/b"] },
  ];
  const result = matchPastedUrls("https://shared.example.com/b", sameHost);
  expect(result.matchedKeys).toEqual([2]);
});
