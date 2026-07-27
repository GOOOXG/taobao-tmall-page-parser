function executeScript() {
  try {
    var response = findPageResponse();
    if (!response) {
      return JSON.stringify({
        code: 1,
        message: "未读取到商品数据。请确认当前是已加载完成的淘宝或天猫商品详情页，然后重新执行。",
        data: null,
        recordTime: null
      });
    }

    var core = parseCorePageData(response);
    var commerce = parseCommerceData(response);
    var details = parseDetailPageData(response);
    core.spuInfo = assign({}, core.spuInfo, commerce);
    core.detailPageInfo = details;

    return JSON.stringify({
      code: 0,
      message: null,
      data: core,
      recordTime: null
    });
  } catch (error) {
    return JSON.stringify({
      code: 1,
      message: error && error.message ? error.message : String(error),
      data: null,
      recordTime: null
    });
  }

  function assign(target) {
    for (var index = 1; index < arguments.length; index += 1) {
      var source = arguments[index] || {};
      Object.keys(source).forEach(function (key) {
        target[key] = source[key];
      });
    }
    return target;
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeUrl(url) {
    if (!url) return null;
    return String(url).indexOf("//") === 0 ? "https:" + url : String(url);
  }

  function getPath(value, path) {
    var current = value;
    for (var index = 0; index < path.length; index += 1) {
      if (!current || typeof current !== "object") return null;
      current = current[path[index]];
    }
    return current || null;
  }

  function isPageResponse(value) {
    return Boolean(
      value &&
      typeof value === "object" &&
      value.item &&
      (value.skuBase || value.skuCore || value.componentsVO || value.seller)
    );
  }

  function unwrapResponse(value) {
    var candidates = [
      value,
      getPath(value, ["loaderData", "home", "data", "res"]),
      getPath(value, ["home", "data", "res"]),
      getPath(value, ["data", "res"]),
      getPath(value, ["props", "pageProps", "data", "res"])
    ];
    for (var index = 0; index < candidates.length; index += 1) {
      if (isPageResponse(candidates[index])) return candidates[index];
    }
    return null;
  }

  function findNestedResponse(root) {
    if (!root || typeof root !== "object") return null;
    var queue = [{ value: root, depth: 0 }];
    var seen = [];
    var visited = 0;
    while (queue.length && visited < 5000) {
      var entry = queue.shift();
      var value = entry.value;
      visited += 1;
      var direct = unwrapResponse(value);
      if (direct) return direct;
      if (entry.depth >= 8 || seen.indexOf(value) !== -1) continue;
      seen.push(value);
      var keys;
      try {
        keys = Object.keys(value);
      } catch (error) {
        continue;
      }
      for (var index = 0; index < keys.length; index += 1) {
        var child;
        try {
          child = value[keys[index]];
        } catch (error) {
          continue;
        }
        if (child && typeof child === "object") {
          queue.push({ value: child, depth: entry.depth + 1 });
        }
      }
    }
    return null;
  }

  function readFromCurrentContext() {
    var globals = [
      "__ICE_APP_CONTEXT__",
      "__INITIAL_STATE__",
      "__PRELOADED_STATE__",
      "__NEXT_DATA__"
    ];
    for (var index = 0; index < globals.length; index += 1) {
      try {
        var response = findNestedResponse(window[globals[index]]);
        if (response) return response;
      } catch (error) {
        // Continue with the other page data sources.
      }
    }
    return null;
  }

  function readFromMainWorld() {
    if (
      typeof document === "undefined" ||
      !document.documentElement ||
      typeof document.createElement !== "function"
    ) return null;
    var id = "octopus-page-data-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    var holder = document.createElement("div");
    holder.id = id;
    holder.style.display = "none";
    document.documentElement.appendChild(holder);

    var runner = document.createElement("script");
    var nonceSource = document.querySelector("script[nonce]");
    if (nonceSource && nonceSource.nonce) runner.nonce = nonceSource.nonce;
    runner.text =
      "(function(){try{" +
      "var c=window.__ICE_APP_CONTEXT__||window.__INITIAL_STATE__||window.__PRELOADED_STATE__||window.__NEXT_DATA__;" +
      "var r=c&&c.loaderData&&c.loaderData.home&&c.loaderData.home.data&&c.loaderData.home.data.res;" +
      "if(!r&&c&&c.home&&c.home.data)r=c.home.data.res;" +
      "if(!r&&c&&c.data)r=c.data.res;" +
      "document.getElementById(" + JSON.stringify(id) + ").textContent=JSON.stringify(r||null);" +
      "}catch(e){}})();";

    try {
      (document.head || document.documentElement).appendChild(runner);
      var raw = holder.textContent;
      if (raw) return unwrapResponse(JSON.parse(raw));
    } catch (error) {
      return null;
    } finally {
      if (runner.parentNode) runner.parentNode.removeChild(runner);
      if (holder.parentNode) holder.parentNode.removeChild(holder);
    }
    return null;
  }

  function readFromJsonScripts() {
    var scripts =
      typeof document !== "undefined" && typeof document.querySelectorAll === "function"
        ? document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__')
        : [];
    for (var index = 0; index < scripts.length; index += 1) {
      var raw = scripts[index].textContent;
      if (!raw || raw.indexOf("item") === -1) continue;
      try {
        var response = findNestedResponse(JSON.parse(raw));
        if (response) return response;
      } catch (error) {
        // Ignore unrelated JSON script blocks.
      }
    }
    return null;
  }

  function findPageResponse() {
    return readFromCurrentContext() || readFromMainWorld() || readFromJsonScripts();
  }

  function parseCorePageData(response) {
    var seller = response.seller || {};
    var store = getPath(response, ["componentsVO", "storeCardVO"]) || {};
    var labels = asArray(store.labelList).map(function (item) { return item.contentDesc || ""; });
    var favorableText = labels.find(function (text) { return text.indexOf("好评率") !== -1; });
    var shippingText = labels.find(function (text) { return text.indexOf("发货") !== -1; });
    var serviceText = labels.find(function (text) { return text.indexOf("客服满意度") !== -1; });
    var favorableMatch = favorableText && favorableText.match(/^(.*?)好评率([\d.]+)%$/);
    var shippingMatch = shippingText && shippingText.match(/平均(.+?)发货/);
    var serviceMatch = serviceText && serviceText.match(/([\d.]+)%/);

    var shopInfo = {
      shopId: String(seller.shopId || ""),
      sellerId: String(seller.sellerId || seller.userId || ""),
      shopName: store.shopName || seller.shopName || seller.sellerNick || null,
      shopType: store.sellerType || seller.sellerType || null,
      shopIcon: normalizeUrl(store.shopIcon || seller.shopIcon),
      shopUrl: normalizeUrl(store.shopUrl || seller.pcShopUrl),
      overallScore: Number(store.overallScore || 0),
      ratings: asArray(store.evaluates).map(function (rating) {
        return { name: rating.title, score: Number(String(rating.score || "").trim()) };
      }),
      actions: asArray(store.buttons).map(function (button) {
        return button.title && button.title.text;
      }).filter(Boolean)
    };
    if (favorableMatch) {
      shopInfo.favorableRate = {
        type: favorableMatch[1] || null,
        percentage: Number(favorableMatch[2])
      };
    }
    if (shippingMatch) shopInfo.averageShippingTime = shippingMatch[1];
    if (serviceMatch) shopInfo.customerServiceSatisfaction = Number(serviceMatch[1]);
    if (store.creditLevel || seller.creditLevel) {
      shopInfo.creditLevel = Number(store.creditLevel || seller.creditLevel);
    }

    var item = response.item || {};
    var headImage = getPath(response, ["componentsVO", "headImageVO"]) || {};
    var images = asArray(headImage.images || item.images).map(normalizeUrl).filter(Boolean);
    var videos = asArray(headImage.videos || item.videos);
    var firstVideo = videos[0];
    var media = {};
    if (firstVideo && (firstVideo.url || firstVideo.videoUrl)) {
      media.videoCover = normalizeUrl(firstVideo.videoThumbnailURL || firstVideo.thumbnailUrl || firstVideo.cover);
      media.video = {
        videoId: String(firstVideo.videoId || firstVideo.id || ""),
        videoUrl: normalizeUrl(firstVideo.url || firstVideo.videoUrl)
      };
      if (media.video.videoUrl) media.video.videoUrl = media.video.videoUrl.replace(/^http:/, "https:");
    }
    if (images.length) media.mainImages = images;

    var props = asArray(getPath(response, ["skuBase", "props"]));
    var valueMap = {};
    props.forEach(function (property) {
      asArray(property.values).forEach(function (value) {
        valueMap[String(value.vid)] = value;
      });
    });
    var sku2info = getPath(response, ["skuCore", "sku2info"]) || {};
    var skuItems = asArray(getPath(response, ["skuBase", "skus"])).map(function (sku) {
      var valueIds = String(sku.propPath || "").split(";").filter(Boolean).map(function (part) {
        return part.split(":")[1];
      }).filter(Boolean);
      var values = valueIds.map(function (valueId) { return valueMap[String(valueId)]; });
      var info = sku2info[sku.skuId] || {};
      var originalPrice = Number(getPath(info, ["price", "priceMoney"]) || 0);
      var currentPrice = Number(
        getPath(info, ["subPrice", "priceMoney"]) ||
        getPath(info, ["price", "priceMoney"]) || 0
      );
      var pictured = values.find(function (value) { return value && value.image; });
      return {
        skuId: String(sku.skuId),
        skuName: values.map(function (value) { return value && value.name; }).filter(Boolean).join(" / "),
        skuPicUrl: normalizeUrl((pictured && pictured.image) || images[0]),
        finalSkuPrice: currentPrice,
        thirdOriginalDiscountPrice: currentPrice,
        valueList: valueIds,
        itemPrice: originalPrice,
        rate: null,
        finalPrice: currentPrice,
        multipleTag: null,
        priceDesc: null,
        stock: String(info.quantity == null ? 0 : info.quantity)
      };
    });

    var properties = props.map(function (property) {
      var output = {
        propertyId: String(property.pid),
        propertyName: property.name,
        itemPropertyValues: asArray(property.values).map(function (value) {
          return {
            valueId: String(value.vid),
            value: value.name,
            pic: normalizeUrl(value.image),
            badge: getPath(value, ["corner", "cornerText"]) || null
          };
        })
      };
      if (property.bigImageMode === "true") output.displayModeToggleText = "切换大图模式";
      return output;
    });

    var generic = sku2info["0"] || {};
    var quantityInfo = {
      value: Number(generic.quantityDisplayValue || 1),
      minimum: 1,
      stockQuantity: Number(generic.quantity || 0),
      stockText: generic.quantityText || null
    };
    if (generic.limit) {
      quantityInfo.maximum = Number(generic.limit);
      quantityInfo.purchaseLimit = Number(generic.limit);
    }

    return {
      shopInfo: shopInfo,
      spuInfo: {
        itemId: Number(item.itemId),
        title: item.title || null,
        itemPic: images[0] || null,
        images: images,
        media: media
      },
      skuInfo: {
        properties: properties,
        items: skuItems,
        quantityInfo: quantityInfo
      }
    };
  }

  function parseCommerceData(response) {
    var components = response.componentsVO || {};
    var result = {};
    var subtitleRoot = document.querySelector('[class*="subTitleWrap--"]');
    var subtitleTexts = subtitleRoot
      ? Array.prototype.map.call(subtitleRoot.querySelectorAll('[class*="itemInfo--"]'), function (element) {
          return String(element.textContent || "").trim();
        }).filter(Boolean)
      : [];
    var soldCount = getPath(response, ["item", "vagueSellCount"]);
    var invoiceText = subtitleTexts.find(function (text) { return text === "可开发票"; });
    var endorsements = asArray(getPath(components, ["itemEndorseVO", "endorseList"]));
    var reviewItem = endorsements.find(function (item) { return item.type === "itemRate"; });
    var cartItem = endorsements.find(function (item) { return item.type === "itemAddCart"; });
    var reviewText = reviewItem && asArray(reviewItem.textList)[0];
    var cartAddText = cartItem && asArray(cartItem.textList)[0];
    var reviewMatch = reviewText && reviewText.match(/^(\d+)人评价["“](.+?)["”]$/);
    var salesInfo = {};
    if (soldCount) {
      salesInfo.soldText = "已售 " + soldCount;
      salesInfo.soldCount = soldCount;
    }
    salesInfo.invoiceAvailable = Boolean(invoiceText);
    if (invoiceText) salesInfo.invoiceText = invoiceText;
    if (reviewMatch) {
      salesInfo.reviewHighlight = { count: Number(reviewMatch[1]), text: reviewMatch[2] };
    }
    if (cartAddText) salesInfo.cartAddText = cartAddText;
    if (Object.keys(salesInfo).length) result.salesInfo = salesInfo;

    var generic = getPath(response, ["skuCore", "sku2info", "0"]) || {};
    var priceVO = components.priceVO || {};
    var currentSource = priceVO.extraPrice || generic.subPrice || priceVO.price;
    var originalSource = priceVO.price || generic.price;
    if (currentSource || originalSource) {
      var priceInfo = {
        currency: "CNY",
        unit: (currentSource && currentSource.priceUnit) || (originalSource && originalSource.priceUnit) || "￥"
      };
      if (currentSource) {
        priceInfo.currentPrice = {
          title: currentSource.priceTitle || null,
          text: currentSource.priceText || null,
          amount: Number(currentSource.priceMoney || 0)
        };
        if (currentSource.priceDesc) priceInfo.currentPrice.suffix = currentSource.priceDesc;
      }
      if (originalSource && (!currentSource || originalSource.priceMoney !== currentSource.priceMoney)) {
        priceInfo.originalPrice = {
          title: originalSource.priceTitle || null,
          text: originalSource.priceText || null,
          amount: Number(originalSource.priceMoney || 0)
        };
        if (originalSource.priceDesc) priceInfo.originalPrice.suffix = originalSource.priceDesc;
      }
      var belt = priceVO.mainBelt;
      if (belt) {
        priceInfo.campaign = {};
        if (belt.logo) priceInfo.campaign.logo = normalizeUrl(belt.logo);
        if (belt.priceBeltImg) priceInfo.campaign.backgroundImage = normalizeUrl(belt.priceBeltImg);
        if (getPath(belt, ["rightBelt", "text"])) priceInfo.campaign.endTimeText = belt.rightBelt.text;
        if (getPath(belt, ["rightBelt", "extraText"])) priceInfo.campaign.statusText = belt.rightBelt.extraText;
      }
      result.priceInfo = priceInfo;
    }

    var couponSection = asArray(getPath(components, ["extensionInfoVO", "infos"])).find(function (section) {
      return section.title === "优惠" || String(section.type || "").indexOf("COUPON") !== -1;
    });
    var couponItems = asArray(couponSection && couponSection.items).map(function (item) {
      return asArray(item.text)[0];
    }).filter(Boolean).map(function (text) {
      var official = text.match(/^官方立减([^省]+)省([\d.]+)元$/);
      var taoCoin = text.match(/^淘金币已抵([\d.]+)元$/);
      if (official) {
        return {
          type: "officialDiscount",
          text: text,
          discountRate: official[1],
          discountAmount: Math.round(Number(official[2]) * 100)
        };
      }
      if (taoCoin) {
        return {
          type: "taoCoin",
          text: text,
          discountRate: null,
          discountAmount: Math.round(Number(taoCoin[1]) * 100)
        };
      }
      return { type: "other", text: text };
    });
    if (couponItems.length) result.couponInfo = { items: couponItems };

    var rank = components.rankEndorsePcDetailVO;
    if (rank && rank.text) {
      result.rankingInfo = {
        text: rank.text,
        category: rank.rankName,
        type: rank.rankTypeName,
        rank: Number(rank.rankNumber)
      };
    }
    var delivery = components.deliveryVO;
    if (delivery) {
      result.deliveryInfo = {};
      if (delivery.agingDesc) result.deliveryInfo.estimatedDelivery = delivery.agingDesc;
      if (delivery.freight) result.deliveryInfo.freight = delivery.freight;
      if (delivery.deliveryFromAddr) result.deliveryInfo.origin = delivery.deliveryFromAddr;
      if (delivery.deliverToCity || delivery.deliveryToDistrict) {
        result.deliveryInfo.destination = {};
        if (delivery.deliverToCity) result.deliveryInfo.destination.city = delivery.deliverToCity;
        if (delivery.deliveryToDistrict) result.deliveryInfo.destination.district = delivery.deliveryToDistrict;
      }
    }

    var guaranteeSections = asArray(getPath(components, ["extensionInfoVO", "infos"])).filter(function (section) {
      return section.type === "GUARANTEE" || section.type === "GUARANTEE_NEW";
    });
    var guarantees = [];
    guaranteeSections.forEach(function (section) {
      asArray(section.items).forEach(function (item) {
        asArray(item.text).forEach(function (text) {
          var label = item.title || text;
          if (label && guarantees.indexOf(label) === -1) guarantees.push(label);
        });
      });
    });
    if (guarantees.length) result.guaranteeInfo = guarantees;
    var payments = asArray(getPath(components, ["payVO", "payConfigList"])).map(function (item) {
      return item.text;
    }).filter(Boolean);
    if (payments.length) result.paymentInfo = payments;
    return result;
  }

  function parseDetailPageData(response) {
    var result = {};
    var tabs = asArray(getPath(response, ["componentsVO", "tabVO", "tabList"])).slice().sort(function (a, b) {
      return Number(a.sort || 0) - Number(b.sort || 0);
    }).map(function (tab) {
      return { name: tab.name, title: tab.title };
    });
    if (tabs.length) result.sectionOrder = tabs;

    var rate = getPath(response, ["componentsVO", "rateVO"]);
    if (rate) {
      var reviewInfo = {};
      if (rate.totalCount) reviewInfo.totalCount = rate.totalCount;
      if (getPath(rate, ["favorableRate", "rateText"])) reviewInfo.favorableRateText = rate.favorableRate.rateText;
      var keywords = asArray(rate.keywords).map(function (keyword) {
        return { text: keyword.title, count: Number(keyword.count || 0) };
      });
      if (keywords.length) reviewInfo.keywords = keywords;
      var samples = asArray(getPath(rate, ["group", "items"])).map(function (review) {
        var sample = {
          userName: review.userName,
          date: review.dateTime,
          content: review.content,
          media: asArray(review.media).map(function (media) {
            var output = { type: media.type };
            if (media.imageUrl) output.imageUrl = normalizeUrl(media.imageUrl);
            if (media.videoUrl) output.videoUrl = normalizeUrl(media.videoUrl);
            return output;
          })
        };
        if (review.skuInfo) sample.skuInfo = review.skuInfo;
        if (review.repurchaseCountText) sample.repurchaseText = review.repurchaseCountText;
        return sample;
      });
      if (samples.length) reviewInfo.samples = samples;
      if (Object.keys(reviewInfo).length) result.reviewInfo = reviewInfo;
    }

    var parameterSource = getPath(response, ["plusViewVO", "industryParamVO"]);
    var highlighted = asArray(parameterSource && parameterSource.enhanceParamList).map(function (item) {
      return { name: item.propertyName, value: item.valueName };
    });
    var basic = asArray(parameterSource && parameterSource.basicParamList).map(function (item) {
      return { name: item.propertyName, value: item.valueName };
    });
    if (highlighted.length || basic.length) {
      result.parameters = {};
      if (highlighted.length) result.parameters.highlighted = highlighted;
      if (basic.length) result.parameters.basic = basic;
    }

    var industrialFiles = asArray(getPath(response, ["componentsVO", "industrialSpecVO", "industrialSpecList"]));
    if (industrialFiles.length) {
      result.industrialSpecInfo = {
        files: industrialFiles.slice().sort(function (a, b) {
          return Number(a.fileOrder || 0) - Number(b.fileOrder || 0);
        }).map(function (file) {
          return { name: file.fileName, type: file.fileType, url: normalizeUrl(file.fileUrl) };
        })
      };
    }

    function readTable(section) {
      var columns = getPath(section, ["data", "0", "data", "columnsData"]);
      if (!Array.isArray(columns) || !columns.length) return null;
      var values = columns.map(function (column) {
        return asArray(column.data).map(function (cell) { return cell.value; });
      });
      var rowCount = Math.max.apply(Math, values.map(function (column) { return column.length; })) - 1;
      var table = {
        title: section.title,
        headers: values.map(function (column) { return column[0]; }),
        rows: Array.from({ length: rowCount }, function (_, rowIndex) {
          return values.map(function (column) {
            return column[rowIndex + 1] == null ? null : column[rowIndex + 1];
          });
        })
      };
      if (section.titleUnit) table.unit = section.titleUnit;
      return table;
    }

    var sizeRoot = getPath(response, ["componentsVO", "sizeTableVO", "sizeTableTaoDetailView", "datas"]);
    if (sizeRoot) {
      var sizeInfo = {};
      if (getPath(sizeRoot, ["sizeRecommend", "titleTail"])) {
        sizeInfo.recommendation = {
          buyerFitPercentage: Number(sizeRoot.sizeRecommend.commentRatio),
          fitAssessment: "尺码标准",
          recommendedSize: sizeRoot.sizeRecommend.titleTail
        };
      }
      var heightWeightGuide = readTable(getPath(sizeRoot, ["sizeData", "heightTable"]));
      var sizeChart = readTable(getPath(sizeRoot, ["sizeData", "sizeTable"]));
      var buyerReferences = readTable(getPath(sizeRoot, ["sizeData", "userSize"]));
      if (heightWeightGuide) sizeInfo.heightWeightGuide = heightWeightGuide;
      if (sizeChart) sizeInfo.sizeChart = sizeChart;
      if (buyerReferences) sizeInfo.buyerReferences = buyerReferences;
      var moreButton = asArray(sizeRoot.buttons).find(function (button) { return button.type === "moreSize"; });
      if (moreButton && moreButton.title) sizeInfo.moreActionText = moreButton.title;
      if (Object.keys(sizeInfo).length) result.sizeInfo = sizeInfo;
    }

    var imageTextRoot = document.querySelector(
      '[class*="imageTextInfo--"], [data-name="imageTextInfo"], #J_DivItemDesc, .descV8-container'
    );
    if (imageTextRoot) {
      var seen = {};
      var detailImages = Array.prototype.map.call(imageTextRoot.querySelectorAll("img"), function (image) {
        var rawUrl =
          image.getAttribute("data-src") ||
          image.getAttribute("data-ks-lazyload") ||
          image.getAttribute("data-lazyload") ||
          image.getAttribute("data-original") ||
          image.getAttribute("src") ||
          image.currentSrc;
        return {
          url: normalizeUrl(rawUrl),
          width: image.naturalWidth || undefined,
          height: image.naturalHeight || undefined
        };
      }).filter(function (image) {
        if (!image.url || seen[image.url]) return false;
        seen[image.url] = true;
        return true;
      }).map(function (image, index) {
        var output = { index: index, url: image.url };
        if (image.width) output.width = image.width;
        if (image.height) output.height = image.height;
        return output;
      });
      if (detailImages.length) result.imageTextInfo = { images: detailImages };
    }
    return result;
  }
}
