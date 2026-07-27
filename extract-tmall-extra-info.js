function yuanToCents(value) {
  return Math.round(Number(value) * 100);
}

function parseCoupon(text) {
  const officialMatch = text.match(/^官方立减([^省]+)省([\d.]+)元$/);
  if (officialMatch) {
    return {
      type: "officialDiscount",
      text,
      discountRate: officialMatch[1],
      discountAmount: yuanToCents(officialMatch[2]),
    };
  }

  const taoCoinMatch = text.match(/^淘金币已抵([\d.]+)元$/);
  if (taoCoinMatch) {
    return {
      type: "taoCoin",
      text,
      discountRate: null,
      discountAmount: yuanToCents(taoCoinMatch[1]),
    };
  }

  return {
    type: "other",
    text,
    discountRate: null,
    discountAmount: null,
  };
}

function readColumnTable(section) {
  const columns = section?.data?.[0]?.data?.columnsData;
  if (!Array.isArray(columns) || columns.length === 0) {
    return null;
  }

  const columnValues = columns.map((column) =>
    column.data.map((cell) => cell.value),
  );
  const rowCount = Math.max(...columnValues.map((column) => column.length)) - 1;

  return {
    title: section.title,
    ...(section.titleUnit ? { unit: section.titleUnit } : {}),
    headers: columnValues.map((column) => column[0]),
    rows: Array.from({ length: rowCount }, (_, rowIndex) =>
      columnValues.map((column) => column[rowIndex + 1] ?? null),
    ),
  };
}

function extractUnderMainMedia(pageWindow = window) {
  const response =
    pageWindow.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res;
  if (!response) {
    return undefined;
  }

  const result = {};
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

  const sizeRoot =
    response.componentsVO?.sizeTableVO?.sizeTableTaoDetailView?.datas;
  if (sizeRoot) {
    const sizeInfo = {};
    const recommendation = sizeRoot.sizeRecommend;

    if (recommendation?.titleTail) {
      sizeInfo.recommendation = {
        buyerFitPercentage: Number(recommendation.commentRatio),
        fitAssessment: "尺码标准",
        recommendedSize: recommendation.titleTail,
      };
    }

    const heightWeightGuide = readColumnTable(sizeRoot.sizeData?.heightTable);
    const sizeChart = readColumnTable(sizeRoot.sizeData?.sizeTable);
    const buyerReferences = readColumnTable(sizeRoot.sizeData?.userSize);

    if (heightWeightGuide) sizeInfo.heightWeightGuide = heightWeightGuide;
    if (sizeChart) sizeInfo.sizeChart = sizeChart;
    if (buyerReferences) sizeInfo.buyerReferences = buyerReferences;

    const moreActionText = sizeRoot.buttons?.find(
      (button) => button.type === "moreSize",
    )?.title;
    if (moreActionText) sizeInfo.moreActionText = moreActionText;

    if (Object.keys(sizeInfo).length > 0) {
      result.sizeInfo = sizeInfo;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function extractImageTextInfo(root = document) {
  const container = root.querySelector('[class*="imageTextInfo--"]');
  if (!container) {
    return undefined;
  }

  const seen = new Set();
  const images = Array.from(container.querySelectorAll("img"))
    .map((image) => {
      const rawUrl =
        image.getAttribute("data-src") ||
        image.getAttribute("data-ks-lazyload") ||
        image.getAttribute("src") ||
        image.currentSrc;
      const url = rawUrl?.startsWith("//") ? `https:${rawUrl}` : rawUrl;
      return {
        url,
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

  return images.length > 0 ? { images } : undefined;
}

function extractTmallExtraInfo(root = document) {
  const subtitleRoot = root.querySelector('[class*="subTitleWrap--"]');
  const subtitleTexts = subtitleRoot
    ? Array.from(subtitleRoot.querySelectorAll('[class*="itemInfo--"]'))
        .map((element) => element.textContent.trim())
        .filter(Boolean)
    : [];

  const soldText = subtitleTexts.find((text) => text.startsWith("已售")) || null;
  const invoiceText = subtitleTexts.find((text) => text === "可开发票") || null;
  const reviewText = subtitleTexts.find((text) => /人评价/.test(text)) || null;
  const cartAddText = subtitleTexts.find((text) => text.includes("人加购")) || null;
  const reviewMatch = reviewText?.match(/^(\d+)人评价["“](.+?)["”]$/);

  const couponTexts = Array.from(
    root.querySelectorAll('[class*="couponInfoArea--"] [class*="CouponItem--"]'),
  )
    .map((element) => element.getAttribute("title") || element.textContent.trim())
    .filter(Boolean);
  const underMainMedia = extractUnderMainMedia(root.defaultView || window);
  const imageTextInfo = extractImageTextInfo(root);
  const detailPageInfo = {
    ...(underMainMedia?.parameters
      ? { parameters: underMainMedia.parameters }
      : {}),
    ...(underMainMedia?.sizeInfo ? { sizeInfo: underMainMedia.sizeInfo } : {}),
    ...(imageTextInfo ? { imageTextInfo } : {}),
  };

  return {
    salesInfo: {
      soldText,
      soldCount: soldText?.replace(/^已售\s*/, "") || null,
      invoiceAvailable: Boolean(invoiceText),
      invoiceText,
      reviewHighlight: reviewMatch
        ? { count: Number(reviewMatch[1]), text: reviewMatch[2] }
        : null,
      cartAddText,
    },
    couponInfo: {
      items: couponTexts.map(parseCoupon),
    },
    ...(Object.keys(detailPageInfo).length > 0 ? { detailPageInfo } : {}),
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    extractTmallExtraInfo,
    extractImageTextInfo,
    extractUnderMainMedia,
    parseCoupon,
    readColumnTable,
  };
}
