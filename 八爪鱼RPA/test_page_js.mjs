import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./页面JS解析.js", import.meta.url), "utf8");

function createContext(response = null) {
  const document = {
    documentElement: {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = response
    ? { __ICE_APP_CONTEXT__: { loaderData: { home: { data: { res: response } } } } }
    : {};
  const context = vm.createContext({ document, window });
  vm.runInContext(source, context);
  return context;
}

test("returns a non-empty JSON string with the required data order", () => {
  const context = createContext({
    seller: { shopId: 12, sellerId: 34, sellerNick: "示例店铺" },
    item: { itemId: 901024796701, title: "示例商品", images: ["//img.example/main.jpg"] },
    skuBase: {
      props: [{ pid: 1, name: "颜色", values: [{ vid: 2, name: "黑色", image: "//img.example/black.jpg" }] }],
      skus: [{ skuId: 3, propPath: "1:2" }],
    },
    skuCore: {
      sku2info: {
        0: { quantity: 9 },
        3: {
          quantity: 4,
          price: { priceMoney: "5990" },
          subPrice: { priceMoney: "4750" },
        },
      },
    },
    componentsVO: {
      priceVO: {
        price: { priceMoney: "5990" },
        extraPrice: { priceMoney: "4750" },
      },
      extensionInfoVO: {
        infos: [{ title: "优惠", items: [{ text: ["官方立减12%省10.2元"] }] }],
      },
    },
  });

  const raw = vm.runInContext("executeScript()", context);
  assert.equal(typeof raw, "string");
  assert.ok(raw.length > 0);
  const result = JSON.parse(raw);
  assert.equal(result.code, 0);
  assert.deepEqual(Object.keys(result.data), ["shopInfo", "spuInfo", "skuInfo", "detailPageInfo"]);
  assert.equal(result.data.spuInfo.itemId, 901024796701);
  assert.equal(result.data.skuInfo.items[0].skuId, "3");
  assert.equal(result.data.skuInfo.items[0].finalSkuPrice, 47.5);
  assert.equal(result.data.skuInfo.items[0].itemPrice, 59.9);
  assert.equal(result.data.spuInfo.priceInfo.currentPrice.amount, 47.5);
  assert.equal(result.data.spuInfo.priceInfo.originalPrice.amount, 59.9);
  assert.equal(result.data.spuInfo.couponInfo.items[0].discountAmount, 10.2);
});

test("returns an error JSON string instead of an empty value when page data is unavailable", () => {
  const context = createContext();
  const raw = vm.runInContext("executeScript()", context);
  const result = JSON.parse(raw);
  assert.equal(result.code, 1);
  assert.equal(result.data, null);
  assert.match(result.message, /未读取到商品数据/);
});
