import assert from "node:assert/strict";
import test from "node:test";

import { parseCorePageData } from "./taobao-tmall-page-parser.mjs";

test("keeps main images on spuInfo without duplicating them in media", async () => {
  globalThis.window = {
    __ICE_APP_CONTEXT__: {
      loaderData: {
        home: {
          data: {
            res: {
              seller: {},
              item: {
                itemId: 901024796701,
                title: "示例商品",
                images: ["//img.example/main.jpg"],
              },
              skuBase: { props: [], skus: [] },
              skuCore: { sku2info: {} },
              componentsVO: {
                headImageVO: {
                  images: ["//img.example/main.jpg"],
                  videos: [{
                    videoId: 1,
                    videoThumbnailURL: "//img.example/video-cover.jpg",
                    url: "//video.example/product.mp4",
                  }],
                },
              },
            },
          },
        },
      },
    },
  };

  try {
    const result = await parseCorePageData({
      evaluate(callback) {
        return callback();
      },
    });

    assert.deepEqual(result.spuInfo.images, ["https://img.example/main.jpg"]);
    assert.equal("mainImages" in result.spuInfo.media, false);
    assert.equal(result.spuInfo.media.videoCover, "https://img.example/video-cover.jpg");
    assert.equal(result.spuInfo.media.video.videoUrl, "https://video.example/product.mp4");
  } finally {
    delete globalThis.window;
  }
});
