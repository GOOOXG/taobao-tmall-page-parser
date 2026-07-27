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
      tabVO: {
        tabList: [
          { name: "DETAIL", title: "图文详情", sort: 2 },
          { name: "RATE", title: "商品评价", sort: 1 },
        ],
      },
      rateVO: {
        totalCount: "100+",
        favorableRate: { rateText: "好评率99%" },
        keywords: [{ title: "质量好", count: 10 }],
        group: {
          items: [{ userName: "用户", content: "评价内容", media: [] }],
        },
      },
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
  assert.equal("images" in result.data.spuInfo, false);
  assert.deepEqual(result.data.spuInfo.media.mainImages, ["https://img.example/main.jpg"]);
  assert.equal(result.data.skuInfo.items[0].skuId, "3");
  assert.equal(result.data.skuInfo.items[0].finalSkuPrice, 47.5);
  assert.equal(result.data.skuInfo.items[0].itemPrice, 59.9);
  assert.equal(result.data.spuInfo.priceInfo.currentPrice.amount, 47.5);
  assert.equal(result.data.spuInfo.priceInfo.originalPrice.amount, 59.9);
  assert.equal(result.data.spuInfo.couponInfo.items[0].discountAmount, 10.2);
  assert.equal("sectionOrder" in result.data.detailPageInfo, false);
  assert.equal("reviewInfo" in result.data.detailPageInfo, false);
});

test("returns an error JSON string instead of an empty value when page data is unavailable", () => {
  const context = createContext();
  const raw = vm.runInContext("executeScript()", context);
  const result = JSON.parse(raw);
  assert.equal(result.code, 1);
  assert.equal(result.data, null);
  assert.match(result.message, /未读取到商品数据/);
});
