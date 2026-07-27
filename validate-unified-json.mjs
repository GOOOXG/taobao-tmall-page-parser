import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const defaultFiles = [
  "taobao-item-40995281114.json",
  "taobao-item-1009631260166.json",
  "tmall-item-1054542185970.json",
  "tmall-item-752458951991.json",
  "tmall-item-729097259303.json",
  "tmall-item-826746914686.json",
  "tmall-item-898094138091.json",
];
const files = process.argv.slice(2);
const targets = files.length > 0 ? files : defaultFiles;

function assertKeyOrder(value, expected, label) {
  assert.deepEqual(Object.keys(value), expected, `${label}: field order mismatch`);
}

function validateMedia(media, label) {
  const keys = Object.keys(media);
  const hasVideoCover = Object.hasOwn(media, "videoCover");
  const hasVideo = Object.hasOwn(media, "video");

  assert.equal(
    hasVideoCover,
    hasVideo,
    `${label}: videoCover and video must be emitted together`,
  );
  assert.deepEqual(
    keys,
    hasVideo
      ? ["videoCover", "video", "mainImages"]
      : ["mainImages"],
    `${label}: media order mismatch`,
  );
  assert.ok(
    Array.isArray(media.mainImages) && media.mainImages.length > 0,
    `${label}: mainImages must not be empty`,
  );
}

async function validateFile(file) {
  const absolutePath = path.resolve(directory, file);
  const payload = JSON.parse(await readFile(absolutePath, "utf8"));
  const label = path.basename(file);

  assertKeyOrder(payload, ["code", "message", "data", "recordTime"], label);
  assert.equal(payload.code, 0, `${label}: code must be 0`);
  assert.ok(payload.data && typeof payload.data === "object", `${label}: data missing`);
  assertKeyOrder(
    payload.data,
    ["shopInfo", "spuInfo", "skuInfo", "detailPageInfo"],
    label,
  );

  const { shopInfo, spuInfo, skuInfo, detailPageInfo } = payload.data;
  assert.ok(shopInfo.shopId, `${label}: shopId missing`);
  assert.ok(shopInfo.sellerId, `${label}: sellerId missing`);
  assert.ok(spuInfo.itemId, `${label}: itemId missing`);
  assert.ok(spuInfo.title, `${label}: title missing`);
  validateMedia(spuInfo.media, label);
  assert.ok(
    Array.isArray(skuInfo.items) && skuInfo.items.length > 0,
    `${label}: SKU items must not be empty`,
  );
  assert.ok(
    Array.isArray(detailPageInfo.imageTextInfo?.images) &&
      detailPageInfo.imageTextInfo.images.length > 0,
    `${label}: imageTextInfo images must not be empty`,
  );

  return {
    file: label,
    itemId: spuInfo.itemId,
    skuCount: skuInfo.items.length,
    media: Object.keys(spuInfo.media),
    detailImageCount: detailPageInfo.imageTextInfo.images.length,
    hasIndustrialSpec: Boolean(detailPageInfo.industrialSpecInfo),
  };
}

const results = [];
for (const file of targets) results.push(await validateFile(file));

console.table(results);
console.log(`Validated ${results.length} unified Taobao/Tmall JSON files.`);
