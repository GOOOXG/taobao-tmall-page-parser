import json
import math
import os
import re
import sys
from typing import Any


DEFAULT_CDP_URL = "http://127.0.0.1:9224"


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _number(value: Any, default: int | float = 0) -> int | float:
    if value is None or value == "":
        return default
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    return int(number) if number.is_integer() else number


def _normalize_url(url: Any) -> str | None:
    if not url:
        return None
    text = str(url)
    return f"https:{text}" if text.startswith("//") else text


def _read_table(section: Any) -> dict | None:
    section = _dict(section)
    data = _list(section.get("data"))
    root = _dict(data[0]).get("data") if data else None
    columns = _list(_dict(root).get("columnsData"))
    if not columns:
        return None

    values = [
        [_dict(cell).get("value") for cell in _list(_dict(column).get("data"))]
        for column in columns
    ]
    row_count = max((len(column) for column in values), default=1) - 1
    result = {
        "title": section.get("title"),
        "headers": [column[0] if column else None for column in values],
        "rows": [
            [column[index + 1] if index + 1 < len(column) else None for column in values]
            for index in range(row_count)
        ],
    }
    if section.get("titleUnit"):
        result = {
            "title": result["title"],
            "unit": section["titleUnit"],
            "headers": result["headers"],
            "rows": result["rows"],
        }
    return result


def _build_core(response: dict) -> dict:
    seller = _dict(response.get("seller"))
    components = _dict(response.get("componentsVO"))
    store = _dict(components.get("storeCardVO"))
    labels = [
        _dict(item).get("contentDesc")
        for item in _list(store.get("labelList"))
        if _dict(item).get("contentDesc")
    ]
    favorable_text = next((text for text in labels if "好评率" in text), None)
    shipping_text = next((text for text in labels if "发货" in text), None)
    service_text = next((text for text in labels if "客服满意度" in text), None)
    favorable_match = re.match(r"^(.*?)好评率([\d.]+)%$", favorable_text or "")
    shipping_match = re.search(r"平均(.+?)发货", shipping_text or "")
    service_match = re.search(r"([\d.]+)%", service_text or "")

    shop_info = {
        "shopId": str(seller.get("shopId") or ""),
        "sellerId": str(seller.get("sellerId") or seller.get("userId") or ""),
        "shopName": store.get("shopName") or seller.get("shopName") or seller.get("sellerNick"),
        "shopType": store.get("sellerType") or seller.get("sellerType"),
        "shopIcon": _normalize_url(store.get("shopIcon") or seller.get("shopIcon")),
        "shopUrl": _normalize_url(store.get("shopUrl") or seller.get("pcShopUrl")),
        "overallScore": _number(store.get("overallScore")),
    }
    if favorable_match:
        shop_info["favorableRate"] = {
            "type": favorable_match.group(1) or None,
            "percentage": _number(favorable_match.group(2)),
        }
    if shipping_match:
        shop_info["averageShippingTime"] = shipping_match.group(1)
    if service_match:
        shop_info["customerServiceSatisfaction"] = _number(service_match.group(1))
    shop_info["ratings"] = [
        {"name": rating.get("title"), "score": _number(rating.get("score"))}
        for rating in map(_dict, _list(store.get("evaluates")))
    ]
    credit_level = store.get("creditLevel") or seller.get("creditLevel")
    if credit_level:
        shop_info["creditLevel"] = _number(credit_level)
    shop_info["actions"] = [
        text
        for button in map(_dict, _list(store.get("buttons")))
        if (text := _dict(button.get("title")).get("text"))
    ]

    item = _dict(response.get("item"))
    head_image = _dict(components.get("headImageVO"))
    image_source = head_image.get("images") or item.get("images") or []
    images = [_normalize_url(url) for url in _list(image_source)]
    video_source = head_image.get("videos") or item.get("videos") or []
    first_video = _dict(_list(video_source)[0]) if _list(video_source) else {}
    media = {}
    if first_video.get("url"):
        media["videoCover"] = _normalize_url(first_video.get("videoThumbnailURL"))
        media["video"] = {
            "videoId": str(first_video.get("videoId")),
            "videoUrl": (_normalize_url(first_video.get("url")) or "").replace("http:", "https:", 1),
        }
    if images:
        media["mainImages"] = images

    sku_base = _dict(response.get("skuBase"))
    props = _list(sku_base.get("props"))
    value_map = {}
    for prop in map(_dict, props):
        for value in map(_dict, _list(prop.get("values"))):
            value_map[str(value.get("vid"))] = value

    sku2info = _dict(_dict(response.get("skuCore")).get("sku2info"))
    sku_items = []
    for sku in map(_dict, _list(sku_base.get("skus"))):
        value_ids = [part.split(":", 1)[1] for part in str(sku.get("propPath") or "").split(";") if ":" in part]
        values = [value_map.get(str(value_id), {}) for value_id in value_ids]
        info = _dict(sku2info.get(str(sku.get("skuId"))))
        price = _dict(info.get("price"))
        sub_price = _dict(info.get("subPrice"))
        original_price = _number(price.get("priceMoney"))
        current_price = _number(sub_price.get("priceMoney") or price.get("priceMoney"))
        image_value = next((value.get("image") for value in values if value.get("image")), None)
        sku_items.append({
            "skuId": str(sku.get("skuId")),
            "skuName": " / ".join(str(value.get("name")) for value in values if value.get("name")),
            "skuPicUrl": _normalize_url(image_value or (images[0] if images else None)),
            "finalSkuPrice": current_price,
            "thirdOriginalDiscountPrice": current_price,
            "valueList": value_ids,
            "itemPrice": original_price,
            "rate": None,
            "finalPrice": current_price,
            "multipleTag": None,
            "priceDesc": None,
            "stock": str(info.get("quantity", 0)),
        })

    properties = []
    for prop in map(_dict, props):
        property_data = {
            "propertyId": str(prop.get("pid")),
            "propertyName": prop.get("name"),
        }
        if prop.get("bigImageMode") == "true":
            property_data["displayModeToggleText"] = "切换大图模式"
        property_data["itemPropertyValues"] = [
            {
                "valueId": str(value.get("vid")),
                "value": value.get("name"),
                "pic": _normalize_url(value.get("image")),
                "badge": _dict(value.get("corner")).get("cornerText"),
            }
            for value in map(_dict, _list(prop.get("values")))
        ]
        properties.append(property_data)

    generic = _dict(sku2info.get("0"))
    quantity_info = {
        "value": _number(generic.get("quantityDisplayValue") or 1),
        "minimum": 1,
    }
    if generic.get("limit"):
        quantity_info["maximum"] = _number(generic.get("limit"))
        quantity_info["purchaseLimit"] = _number(generic.get("limit"))
    quantity_info["stockQuantity"] = _number(generic.get("quantity"))
    quantity_info["stockText"] = generic.get("quantityText")

    return {
        "shopInfo": shop_info,
        "spuInfo": {"itemId": _number(item.get("itemId")), "title": item.get("title"), "media": media},
        "skuInfo": {"properties": properties, "items": sku_items, "quantityInfo": quantity_info},
    }


def _build_commerce(response: dict, dom: dict) -> dict:
    components = _dict(response.get("componentsVO"))
    result = {}
    subtitle_texts = _list(dom.get("subtitleTexts"))
    sold_count = _dict(response.get("item")).get("vagueSellCount")
    invoice_text = next((text for text in subtitle_texts if text == "可开发票"), None)
    endorsements = _list(_dict(components.get("itemEndorseVO")).get("endorseList"))
    rate_endorsement = next((_dict(item) for item in endorsements if _dict(item).get("type") == "itemRate"), {})
    cart_endorsement = next((_dict(item) for item in endorsements if _dict(item).get("type") == "itemAddCart"), {})
    review_texts = _list(rate_endorsement.get("textList"))
    cart_texts = _list(cart_endorsement.get("textList"))
    review_text = review_texts[0] if review_texts else None
    cart_text = cart_texts[0] if cart_texts else None
    review_match = re.match(r'^(\d+)人评价["“](.+?)["”]$', review_text or "")
    sales_info = {}
    if sold_count:
        sales_info.update({"soldText": f"已售 {sold_count}", "soldCount": sold_count})
    sales_info["invoiceAvailable"] = bool(invoice_text)
    if invoice_text:
        sales_info["invoiceText"] = invoice_text
    if review_match:
        sales_info["reviewHighlight"] = {"count": int(review_match.group(1)), "text": review_match.group(2)}
    if cart_text:
        sales_info["cartAddText"] = cart_text
    if sales_info:
        result["salesInfo"] = sales_info

    generic = _dict(_dict(_dict(response.get("skuCore")).get("sku2info")).get("0"))
    price_vo = _dict(components.get("priceVO"))
    current_source = _dict(price_vo.get("extraPrice") or generic.get("subPrice") or price_vo.get("price"))
    original_source = _dict(price_vo.get("price") or generic.get("price"))
    if current_source or original_source:
        price_info = {
            "currency": "CNY",
            "unit": current_source.get("priceUnit") or original_source.get("priceUnit") or "￥",
        }
        if current_source:
            current_price = {
                "title": current_source.get("priceTitle"),
                "text": current_source.get("priceText"),
                "amount": _number(current_source.get("priceMoney")),
            }
            if current_source.get("priceDesc"):
                current_price["suffix"] = current_source["priceDesc"]
            price_info["currentPrice"] = current_price
        if original_source and (not current_source or original_source.get("priceMoney") != current_source.get("priceMoney")):
            original_price = {
                "title": original_source.get("priceTitle"),
                "text": original_source.get("priceText"),
                "amount": _number(original_source.get("priceMoney")),
            }
            if original_source.get("priceDesc"):
                original_price["suffix"] = original_source["priceDesc"]
            price_info["originalPrice"] = original_price
        belt = _dict(price_vo.get("mainBelt"))
        if belt:
            campaign = {}
            if belt.get("logo"):
                campaign["logo"] = _normalize_url(belt["logo"])
            if belt.get("priceBeltImg"):
                campaign["backgroundImage"] = _normalize_url(belt["priceBeltImg"])
            right_belt = _dict(belt.get("rightBelt"))
            if right_belt.get("text"):
                campaign["endTimeText"] = right_belt["text"]
            if right_belt.get("extraText"):
                campaign["statusText"] = right_belt["extraText"]
            price_info["campaign"] = campaign
        result["priceInfo"] = price_info

    extension_infos = _list(_dict(components.get("extensionInfoVO")).get("infos"))
    coupon_section = next(
        (_dict(section) for section in extension_infos if _dict(section).get("title") == "优惠" or "COUPON" in str(_dict(section).get("type") or "")),
        {},
    )
    coupon_items = []
    for item in map(_dict, _list(coupon_section.get("items"))):
        texts = _list(item.get("text"))
        if not texts:
            continue
        text = texts[0]
        official = re.match(r"^官方立减([^省]+)省([\d.]+)元$", text)
        tao_coin = re.match(r"^淘金币已抵([\d.]+)元$", text)
        if official:
            coupon_items.append({"type": "officialDiscount", "text": text, "discountRate": official.group(1), "discountAmount": round(float(official.group(2)) * 100)})
        elif tao_coin:
            coupon_items.append({"type": "taoCoin", "text": text, "discountRate": None, "discountAmount": round(float(tao_coin.group(1)) * 100)})
        else:
            coupon_items.append({"type": "other", "text": text})
    if coupon_items:
        result["couponInfo"] = {"items": coupon_items}

    rank = _dict(components.get("rankEndorsePcDetailVO"))
    if rank.get("text"):
        result["rankingInfo"] = {"text": rank["text"], "category": rank.get("rankName"), "type": rank.get("rankTypeName"), "rank": _number(rank.get("rankNumber"))}

    delivery = _dict(components.get("deliveryVO"))
    if delivery:
        delivery_info = {}
        for source, target in (("agingDesc", "estimatedDelivery"), ("freight", "freight"), ("deliveryFromAddr", "origin")):
            if delivery.get(source):
                delivery_info[target] = delivery[source]
        destination = {}
        if delivery.get("deliverToCity"):
            destination["city"] = delivery["deliverToCity"]
        if delivery.get("deliveryToDistrict"):
            destination["district"] = delivery["deliveryToDistrict"]
        if destination:
            delivery_info["destination"] = destination
        result["deliveryInfo"] = delivery_info

    guarantees = []
    for section in map(_dict, extension_infos):
        if section.get("type") not in ("GUARANTEE", "GUARANTEE_NEW"):
            continue
        for item in map(_dict, _list(section.get("items"))):
            for text in _list(item.get("text")):
                label = item.get("title") or text
                if label and label not in guarantees:
                    guarantees.append(label)
    if guarantees:
        result["guaranteeInfo"] = guarantees

    payments = [item.get("text") for item in map(_dict, _list(_dict(components.get("payVO")).get("payConfigList"))) if item.get("text")]
    if payments:
        result["paymentInfo"] = payments
    return result


def _build_details(response: dict, dom: dict) -> dict:
    components = _dict(response.get("componentsVO"))
    result = {}
    tabs = sorted(_list(_dict(components.get("tabVO")).get("tabList")), key=lambda tab: _number(_dict(tab).get("sort")))
    if tabs:
        result["sectionOrder"] = [{"name": _dict(tab).get("name"), "title": _dict(tab).get("title")} for tab in tabs]

    rate = _dict(components.get("rateVO"))
    if rate:
        review_info = {}
        if rate.get("totalCount"):
            review_info["totalCount"] = rate["totalCount"]
        rate_text = _dict(rate.get("favorableRate")).get("rateText")
        if rate_text:
            review_info["favorableRateText"] = rate_text
        keywords = [{"text": item.get("title"), "count": _number(item.get("count"))} for item in map(_dict, _list(rate.get("keywords")))]
        if keywords:
            review_info["keywords"] = keywords
        samples = []
        for review in map(_dict, _list(_dict(rate.get("group")).get("items"))):
            sample = {"userName": review.get("userName"), "date": review.get("dateTime"), "content": review.get("content")}
            if review.get("skuInfo"):
                sample["skuInfo"] = review["skuInfo"]
            if review.get("repurchaseCountText"):
                sample["repurchaseText"] = review["repurchaseCountText"]
            sample["media"] = []
            for media in map(_dict, _list(review.get("media"))):
                media_item = {"type": media.get("type")}
                if media.get("imageUrl"):
                    media_item["imageUrl"] = _normalize_url(media["imageUrl"])
                if media.get("videoUrl"):
                    media_item["videoUrl"] = _normalize_url(media["videoUrl"])
                sample["media"].append(media_item)
            samples.append(sample)
        if samples:
            review_info["samples"] = samples
        if review_info:
            result["reviewInfo"] = review_info

    parameter_source = _dict(_dict(response.get("plusViewVO")).get("industryParamVO"))
    highlighted = [{"name": item.get("propertyName"), "value": item.get("valueName")} for item in map(_dict, _list(parameter_source.get("enhanceParamList")))]
    basic = [{"name": item.get("propertyName"), "value": item.get("valueName")} for item in map(_dict, _list(parameter_source.get("basicParamList")))]
    if highlighted or basic:
        result["parameters"] = {}
        if highlighted:
            result["parameters"]["highlighted"] = highlighted
        if basic:
            result["parameters"]["basic"] = basic

    industrial_files = _list(_dict(components.get("industrialSpecVO")).get("industrialSpecList"))
    if industrial_files:
        result["industrialSpecInfo"] = {"files": [
            {"name": file.get("fileName"), "type": file.get("fileType"), "url": _normalize_url(file.get("fileUrl"))}
            for file in sorted(map(_dict, industrial_files), key=lambda file: _number(file.get("fileOrder")))
        ]}

    size_root = _dict(_dict(_dict(components.get("sizeTableVO")).get("sizeTableTaoDetailView")).get("datas"))
    if size_root:
        size_info = {}
        recommendation = _dict(size_root.get("sizeRecommend"))
        if recommendation.get("titleTail"):
            size_info["recommendation"] = {"buyerFitPercentage": _number(recommendation.get("commentRatio")), "fitAssessment": "尺码标准", "recommendedSize": recommendation["titleTail"]}
        size_data = _dict(size_root.get("sizeData"))
        for source, target in (("heightTable", "heightWeightGuide"), ("sizeTable", "sizeChart"), ("userSize", "buyerReferences")):
            table = _read_table(size_data.get(source))
            if table:
                size_info[target] = table
        more_text = next((button.get("title") for button in map(_dict, _list(size_root.get("buttons"))) if button.get("type") == "moreSize"), None)
        if more_text:
            size_info["moreActionText"] = more_text
        if size_info:
            result["sizeInfo"] = size_info

    seen = set()
    detail_images = []
    for image in map(_dict, _list(dom.get("detailImages"))):
        url = _normalize_url(image.get("url"))
        if not url or url in seen:
            continue
        seen.add(url)
        image_data = {"index": len(detail_images), "url": url}
        if image.get("width"):
            image_data["width"] = image["width"]
        if image.get("height"):
            image_data["height"] = image["height"]
        detail_images.append(image_data)
    if detail_images:
        result["imageTextInfo"] = {"images": detail_images}
    return result


def build_item_payload(response: dict, dom: dict | None = None) -> dict:
    if not isinstance(response, dict) or not response:
        raise ValueError("Taobao/Tmall runtime data is unavailable")
    dom = _dict(dom)
    core = _build_core(response)
    core["spuInfo"].update(_build_commerce(response, dom))
    details = _build_details(response, dom)
    if details:
        core["detailPageInfo"] = details
    return {"code": 0, "message": None, "data": core, "recordTime": None}


def parse_taobao_tmall_page(page: Any) -> dict:
    response = page.evaluate("() => window.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res || null")
    dom = page.evaluate(
        """() => {
          const subtitle = document.querySelector('[class*="subTitleWrap--"]');
          const detail = document.querySelector('[class*="imageTextInfo--"]');
          return {
            subtitleTexts: subtitle ? Array.from(subtitle.querySelectorAll('[class*="itemInfo--"]')).map(e => e.textContent.trim()).filter(Boolean) : [],
            detailImages: detail ? Array.from(detail.querySelectorAll('img')).map(image => ({
              url: image.getAttribute('data-src') || image.getAttribute('data-ks-lazyload') || image.getAttribute('src') || image.currentSrc,
              width: image.naturalWidth || null,
              height: image.naturalHeight || null
            })) : []
          };
        }"""
    )
    return build_item_payload(response, dom)


def parse_item_id(item_id: str, cdp_url: str = DEFAULT_CDP_URL) -> dict:
    item_id = str(item_id).strip()
    if not re.fullmatch(r"\d{6,20}", item_id):
        raise ValueError("商品 ID 格式不正确，只能输入数字商品 ID")

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(cdp_url)
        contexts = browser.contexts
        if not contexts:
            raise RuntimeError("没有找到可用的 Chrome 浏览器上下文")
        page = contexts[0].new_page()
        try:
            errors = []
            for url in (
                f"https://item.taobao.com/item.htm?id={item_id}",
                f"https://detail.tmall.com/item.htm?id={item_id}",
            ):
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=120_000)
                    page.wait_for_function(
                        "() => Boolean(window.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res)",
                        timeout=120_000,
                    )
                    break
                except Exception as error:
                    errors.append(str(error))
            else:
                raise RuntimeError("商品页面加载失败：" + (errors[-1] if errors else "没有读取到商品数据"))

            page.evaluate(
                """async () => {
                  let previousHeight = 0;
                  for (let index = 0; index < 100; index += 1) {
                    window.scrollBy(0, 900);
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const height = document.documentElement.scrollHeight;
                    const atBottom = window.scrollY + window.innerHeight >= height - 20;
                    if (atBottom && height === previousHeight) break;
                    if (atBottom) previousHeight = height;
                  }
                }"""
            )
            page.wait_for_timeout(2_000)
            return parse_taobao_tmall_page(page)
        finally:
            page.close()


def main(msg: Any) -> str:
    try:
        result = parse_item_id(str(msg), os.environ.get("TAOBAO_CDP_URL", DEFAULT_CDP_URL))
    except Exception as error:
        result = {"code": 1, "message": str(error), "data": None, "recordTime": None}
    return json.dumps(result, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python taobao_tmall_page_parser.py <item_id>", file=sys.stderr)
        raise SystemExit(2)
    print(main(sys.argv[1]))
