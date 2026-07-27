export async function parseCorePageData(page) {
  return page.evaluate(() => {
    const response =
      window.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res;
    if (!response) throw new Error("Taobao/Tmall runtime data is unavailable");

    const normalizeUrl = (url) =>
      url?.startsWith("//") ? `https:${url}` : url || null;
    const seller = response.seller || {};
    const store = response.componentsVO?.storeCardVO || {};
    const labels = (store.labelList || []).map((item) => item.contentDesc);
    const favorableText = labels.find((text) => text.includes("好评率"));
    const shippingText = labels.find((text) => text.includes("发货"));
    const serviceText = labels.find((text) => text.includes("客服满意度"));
    const favorableMatch = favorableText?.match(/^(.*?)好评率([\d.]+)%$/);
    const shippingMatch = shippingText?.match(/平均(.+?)发货/);
    const serviceMatch = serviceText?.match(/([\d.]+)%/);

    const shopInfo = {
      shopId: String(seller.shopId || ""),
      sellerId: String(seller.sellerId || seller.userId || ""),
      shopName: store.shopName || seller.shopName || seller.sellerNick || null,
      shopType: store.sellerType || seller.sellerType || null,
      shopIcon: normalizeUrl(store.shopIcon || seller.shopIcon),
      shopUrl: normalizeUrl(store.shopUrl || seller.pcShopUrl),
      overallScore: Number(store.overallScore || 0),
      ...(favorableMatch
        ? {
            favorableRate: {
              type: favorableMatch[1] || null,
              percentage: Number(favorableMatch[2]),
            },
          }
        : {}),
      ...(shippingMatch ? { averageShippingTime: shippingMatch[1] } : {}),
      ...(serviceMatch
        ? { customerServiceSatisfaction: Number(serviceMatch[1]) }
        : {}),
      ratings: (store.evaluates || []).map((rating) => ({
        name: rating.title,
        score: Number(String(rating.score).trim()),
      })),
      ...(store.creditLevel || seller.creditLevel
        ? { creditLevel: Number(store.creditLevel || seller.creditLevel) }
        : {}),
      actions: (store.buttons || []).map((button) => button.title?.text).filter(Boolean),
    };

    const item = response.item || {};
    const headImage = response.componentsVO?.headImageVO || {};
    const images = (headImage.images || item.images || []).map(normalizeUrl);
    const firstVideo = (headImage.videos || item.videos || [])[0];
    const media = {};
    if (firstVideo?.url) {
      media.videoCover = normalizeUrl(firstVideo.videoThumbnailURL);
      media.video = {
        videoId: String(firstVideo.videoId),
        videoUrl: normalizeUrl(firstVideo.url)?.replace(/^http:/, "https:"),
      };
    }
    if (images.length > 0) media.mainImages = images;

    const props = response.skuBase?.props || [];
    const valueMap = new Map();
    for (const property of props) {
      for (const value of property.values || []) {
        valueMap.set(String(value.vid), value);
      }
    }

    const sku2info = response.skuCore?.sku2info || {};
    const items = (response.skuBase?.skus || []).map((sku) => {
      const valueIds = sku.propPath.split(";").map((part) => part.split(":")[1]);
      const values = valueIds.map((valueId) => valueMap.get(String(valueId)));
      const info = sku2info[sku.skuId] || {};
      const originalPrice = Number(info.price?.priceMoney || 0);
      const currentPrice = Number(
        info.subPrice?.priceMoney || info.price?.priceMoney || 0,
      );

      return {
        skuId: String(sku.skuId),
        skuName: values.map((value) => value?.name).filter(Boolean).join(" / "),
        skuPicUrl: normalizeUrl(
          values.find((value) => value?.image)?.image || images[0],
        ),
        finalSkuPrice: currentPrice,
        thirdOriginalDiscountPrice: currentPrice,
        valueList: valueIds,
        itemPrice: originalPrice,
        rate: null,
        finalPrice: currentPrice,
        multipleTag: null,
        priceDesc: null,
        stock: String(info.quantity ?? 0),
      };
    });

    const properties = props.map((property) => ({
      propertyId: String(property.pid),
      propertyName: property.name,
      ...(property.bigImageMode === "true"
        ? { displayModeToggleText: "切换大图模式" }
        : {}),
      itemPropertyValues: (property.values || []).map((value) => ({
        valueId: String(value.vid),
        value: value.name,
        pic: normalizeUrl(value.image),
        badge: value.corner?.cornerText || null,
      })),
    }));

    const generic = sku2info["0"] || {};
    const quantityInfo = {
      value: Number(generic.quantityDisplayValue || 1),
      minimum: 1,
      ...(generic.limit ? { maximum: Number(generic.limit) } : {}),
      ...(generic.limit ? { purchaseLimit: Number(generic.limit) } : {}),
      stockQuantity: Number(generic.quantity || 0),
      stockText: generic.quantityText || null,
    };

    return {
      shopInfo,
      spuInfo: {
        itemId: Number(item.itemId),
        title: item.title,
        media,
      },
      skuInfo: { properties, items, quantityInfo },
    };
  });
}

export async function parseCommerceData(page) {
  return page.evaluate(() => {
    const response =
      window.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res;
    if (!response) throw new Error("Taobao/Tmall runtime data is unavailable");

    const normalizeUrl = (url) =>
      url?.startsWith("//") ? `https:${url}` : url || null;
    const components = response.componentsVO || {};
    const result = {};

    const subtitleRoot = document.querySelector('[class*="subTitleWrap--"]');
    const subtitleTexts = subtitleRoot
      ? Array.from(subtitleRoot.querySelectorAll('[class*="itemInfo--"]'))
          .map((element) => element.textContent.trim())
          .filter(Boolean)
      : [];
    const soldCount = response.item?.vagueSellCount;
    const invoiceText = subtitleTexts.find((text) => text === "可开发票");
    const endorsements = components.itemEndorseVO?.endorseList || [];
    const reviewText = endorsements
      .find((item) => item.type === "itemRate")
      ?.textList?.[0];
    const cartAddText = endorsements
      .find((item) => item.type === "itemAddCart")
      ?.textList?.[0];
    const reviewMatch = reviewText?.match(/^(\d+)人评价["“](.+?)["”]$/);
    const salesInfo = {
      ...(soldCount ? { soldText: `已售 ${soldCount}`, soldCount } : {}),
      ...(invoiceText
        ? { invoiceAvailable: true, invoiceText }
        : { invoiceAvailable: false }),
      ...(reviewMatch
        ? {
            reviewHighlight: {
              count: Number(reviewMatch[1]),
              text: reviewMatch[2],
            },
          }
        : {}),
      ...(cartAddText ? { cartAddText } : {}),
    };
    if (Object.keys(salesInfo).length > 0) result.salesInfo = salesInfo;

    const generic = response.skuCore?.sku2info?.["0"] || {};
    const priceVO = components.priceVO || {};
    const currentSource = priceVO.extraPrice || generic.subPrice || priceVO.price;
    const originalSource = priceVO.price || generic.price;
    if (currentSource || originalSource) {
      const priceInfo = {
        currency: "CNY",
        unit: currentSource?.priceUnit || originalSource?.priceUnit || "￥",
      };
      if (currentSource) {
        priceInfo.currentPrice = {
          title: currentSource.priceTitle || null,
          text: currentSource.priceText || null,
          amount: Number(currentSource.priceMoney || 0),
          ...(currentSource.priceDesc ? { suffix: currentSource.priceDesc } : {}),
        };
      }
      if (
        originalSource &&
        (!currentSource || originalSource.priceMoney !== currentSource.priceMoney)
      ) {
        priceInfo.originalPrice = {
          title: originalSource.priceTitle || null,
          text: originalSource.priceText || null,
          amount: Number(originalSource.priceMoney || 0),
          ...(originalSource.priceDesc ? { suffix: originalSource.priceDesc } : {}),
        };
      }
      const belt = priceVO.mainBelt;
      if (belt) {
        priceInfo.campaign = {
          ...(belt.logo ? { logo: normalizeUrl(belt.logo) } : {}),
          ...(belt.priceBeltImg
            ? { backgroundImage: normalizeUrl(belt.priceBeltImg) }
            : {}),
          ...(belt.rightBelt?.text
            ? { endTimeText: belt.rightBelt.text }
            : {}),
          ...(belt.rightBelt?.extraText
            ? { statusText: belt.rightBelt.extraText }
            : {}),
        };
      }
      result.priceInfo = priceInfo;
    }

    const couponSection = (components.extensionInfoVO?.infos || []).find(
      (section) => section.title === "优惠" || section.type?.includes("COUPON"),
    );
    const couponItems = (couponSection?.items || [])
      .map((item) => item.text?.[0])
      .filter(Boolean)
      .map((text) => {
        const official = text.match(/^官方立减([^省]+)省([\d.]+)元$/);
        const taoCoin = text.match(/^淘金币已抵([\d.]+)元$/);
        if (official) {
          return {
            type: "officialDiscount",
            text,
            discountRate: official[1],
            discountAmount: Math.round(Number(official[2]) * 100),
          };
        }
        if (taoCoin) {
          return {
            type: "taoCoin",
            text,
            discountRate: null,
            discountAmount: Math.round(Number(taoCoin[1]) * 100),
          };
        }
        return { type: "other", text };
      });
    if (couponItems.length > 0) result.couponInfo = { items: couponItems };

    const rank = components.rankEndorsePcDetailVO;
    if (rank?.text) {
      result.rankingInfo = {
        text: rank.text,
        category: rank.rankName,
        type: rank.rankTypeName,
        rank: Number(rank.rankNumber),
      };
    }

    const delivery = components.deliveryVO;
    if (delivery) {
      result.deliveryInfo = {
        ...(delivery.agingDesc
          ? { estimatedDelivery: delivery.agingDesc }
          : {}),
        ...(delivery.freight ? { freight: delivery.freight } : {}),
        ...(delivery.deliveryFromAddr
          ? { origin: delivery.deliveryFromAddr }
          : {}),
        ...(delivery.deliverToCity || delivery.deliveryToDistrict
          ? {
              destination: {
                ...(delivery.deliverToCity
                  ? { city: delivery.deliverToCity }
                  : {}),
                ...(delivery.deliveryToDistrict
                  ? { district: delivery.deliveryToDistrict }
                  : {}),
              },
            }
          : {}),
      };
    }

    const guaranteeSections = (components.extensionInfoVO?.infos || []).filter(
      (section) => section.type === "GUARANTEE" || section.type === "GUARANTEE_NEW",
    );
    const guarantees = [];
    for (const section of guaranteeSections) {
      for (const item of section.items || []) {
        for (const text of item.text || []) {
          const label = item.title || text;
          if (label && !guarantees.includes(label)) guarantees.push(label);
        }
      }
    }
    if (guarantees.length > 0) result.guaranteeInfo = guarantees;

    const payments = (components.payVO?.payConfigList || [])
      .map((item) => item.text)
      .filter(Boolean);
    if (payments.length > 0) result.paymentInfo = payments;

    return result;
  });
}

export async function parseDetailPageData(page) {
  return page.evaluate(() => {
    const response =
      window.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res;
    if (!response) throw new Error("Taobao/Tmall runtime data is unavailable");

    const normalizeUrl = (url) =>
      url?.startsWith("//") ? `https:${url}` : url || null;
    const result = {};

    const tabs = (response.componentsVO?.tabVO?.tabList || [])
      .slice()
      .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
      .map((tab) => ({ name: tab.name, title: tab.title }));
    if (tabs.length > 0) result.sectionOrder = tabs;

    const rate = response.componentsVO?.rateVO;
    if (rate) {
      const reviewInfo = {
        ...(rate.totalCount ? { totalCount: rate.totalCount } : {}),
        ...(rate.favorableRate?.rateText
          ? { favorableRateText: rate.favorableRate.rateText }
          : {}),
        keywords: (rate.keywords || []).map((keyword) => ({
          text: keyword.title,
          count: Number(keyword.count || 0),
        })),
        samples: (rate.group?.items || []).map((review) => ({
          userName: review.userName,
          date: review.dateTime,
          content: review.content,
          ...(review.skuInfo ? { skuInfo: review.skuInfo } : {}),
          ...(review.repurchaseCountText
            ? { repurchaseText: review.repurchaseCountText }
            : {}),
          media: (review.media || []).map((media) => ({
            type: media.type,
            ...(media.imageUrl
              ? { imageUrl: normalizeUrl(media.imageUrl) }
              : {}),
            ...(media.videoUrl
              ? { videoUrl: normalizeUrl(media.videoUrl) }
              : {}),
          })),
        })),
      };
      if (reviewInfo.keywords.length === 0) delete reviewInfo.keywords;
      if (reviewInfo.samples.length === 0) delete reviewInfo.samples;
      if (Object.keys(reviewInfo).length > 0) result.reviewInfo = reviewInfo;
    }

    const parameterSource = response.plusViewVO?.industryParamVO;
    const highlighted = (parameterSource?.enhanceParamList || []).map((item) => ({
      name: item.propertyName,
      value: item.valueName,
    }));
    const basic = (parameterSource?.basicParamList || []).map((item) => ({
      name: item.propertyName,
      value: item.valueName,
    }));
    if (highlighted.length > 0 || basic.length > 0) {
      result.parameters = {
        ...(highlighted.length > 0 ? { highlighted } : {}),
        ...(basic.length > 0 ? { basic } : {}),
      };
    }

    const industrialFiles =
      response.componentsVO?.industrialSpecVO?.industrialSpecList || [];
    if (industrialFiles.length > 0) {
      result.industrialSpecInfo = {
        files: industrialFiles
          .slice()
          .sort((a, b) => Number(a.fileOrder || 0) - Number(b.fileOrder || 0))
          .map((file) => ({
            name: file.fileName,
            type: file.fileType,
            url: normalizeUrl(file.fileUrl),
          })),
      };
    }

    const readTable = (section) => {
      const columns = section?.data?.[0]?.data?.columnsData;
      if (!Array.isArray(columns) || columns.length === 0) return null;
      const values = columns.map((column) =>
        column.data.map((cell) => cell.value),
      );
      const rowCount = Math.max(...values.map((column) => column.length)) - 1;
      return {
        title: section.title,
        ...(section.titleUnit ? { unit: section.titleUnit } : {}),
        headers: values.map((column) => column[0]),
        rows: Array.from({ length: rowCount }, (_, rowIndex) =>
          values.map((column) => column[rowIndex + 1] ?? null),
        ),
      };
    };

    const sizeRoot =
      response.componentsVO?.sizeTableVO?.sizeTableTaoDetailView?.datas;
    if (sizeRoot) {
      const sizeInfo = {};
      if (sizeRoot.sizeRecommend?.titleTail) {
        sizeInfo.recommendation = {
          buyerFitPercentage: Number(sizeRoot.sizeRecommend.commentRatio),
          fitAssessment: "尺码标准",
          recommendedSize: sizeRoot.sizeRecommend.titleTail,
        };
      }
      const heightWeightGuide = readTable(sizeRoot.sizeData?.heightTable);
      const sizeChart = readTable(sizeRoot.sizeData?.sizeTable);
      const buyerReferences = readTable(sizeRoot.sizeData?.userSize);
      if (heightWeightGuide) sizeInfo.heightWeightGuide = heightWeightGuide;
      if (sizeChart) sizeInfo.sizeChart = sizeChart;
      if (buyerReferences) sizeInfo.buyerReferences = buyerReferences;
      const moreActionText = sizeRoot.buttons?.find(
        (button) => button.type === "moreSize",
      )?.title;
      if (moreActionText) sizeInfo.moreActionText = moreActionText;
      if (Object.keys(sizeInfo).length > 0) result.sizeInfo = sizeInfo;
    }

    const imageTextRoot = document.querySelector('[class*="imageTextInfo--"]');
    if (imageTextRoot) {
      const seen = new Set();
      const images = Array.from(imageTextRoot.querySelectorAll("img"))
        .map((image) => {
          const rawUrl =
            image.getAttribute("data-src") ||
            image.getAttribute("data-ks-lazyload") ||
            image.getAttribute("src") ||
            image.currentSrc;
          return {
            url: normalizeUrl(rawUrl),
            width: image.naturalWidth || undefined,
            height: image.naturalHeight || undefined,
          };
        })
        .filter((image) => {
          if (!image.url || seen.has(image.url)) return false;
          seen.add(image.url);
          return true;
        })
        .map((image, index) => ({
          index,
          url: image.url,
          ...(image.width ? { width: image.width } : {}),
          ...(image.height ? { height: image.height } : {}),
        }));
      if (images.length > 0) result.imageTextInfo = { images };
    }

    return result;
  });
}

export async function parseTaobaoTmallPage(page) {
  const core = await parseCorePageData(page);
  const commerce = await parseCommerceData(page);
  const details = await parseDetailPageData(page);
  core.spuInfo = { ...core.spuInfo, ...commerce };
  if (Object.keys(details).length > 0) core.detailPageInfo = details;
  return {
    code: 0,
    message: null,
    data: core,
    recordTime: null,
  };
}

// Backward-compatible aliases; both platforms use the same implementation.
export const parseTaobaoPage = parseTaobaoTmallPage;
export const parseTmallPage = parseTaobaoTmallPage;
