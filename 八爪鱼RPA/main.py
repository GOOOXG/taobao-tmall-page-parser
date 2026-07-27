import base64
import concurrent.futures
import hashlib
import json
import os
import pathlib
import re
import socket
import struct
import subprocess
import time
import urllib.request
from urllib.parse import urlsplit
from typing import Any, Dict, List, Optional, Tuple

NAVIGATION_TIMEOUT_MS = 120_000
COMMON_CDP_PORTS = tuple(range(9222, 9233))

CORE_SCRIPT = r"""() => {
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
  }"""

COMMERCE_SCRIPT = r"""() => {
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
  }"""

DETAIL_SCRIPT = r"""() => {
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
  }"""

LAZY_LOAD_SCRIPT = r"""async () => {
  let previousHeight = 0;
  for (let index = 0; index < 100; index += 1) {
    window.scrollBy(0, 900);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const height = document.documentElement.scrollHeight;
    const atBottom = window.scrollY + window.innerHeight >= height - 20;
    if (atBottom && height === previousHeight) break;
    if (atBottom) previousHeight = height;
  }
}"""


def _validate_item_id(value: Any) -> str:
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    item_id = str(value).strip()
    if not re.fullmatch(r"[0-9]{6,20}", item_id):
        raise ValueError("商品 ID 格式不正确，只能输入 6 至 20 位数字")
    return item_id


def _error_result(error: Exception) -> Dict[str, Any]:
    return {
        "code": 1,
        "message": str(error) or "解析失败",
        "data": None,
        "recordTime": None,
    }


def _build_result(
    core_data: Dict[str, Any],
    commerce_data: Dict[str, Any],
    detail_data: Dict[str, Any],
) -> Dict[str, Any]:
    core_data["spuInfo"].update(commerce_data)
    if detail_data:
        core_data["detailPageInfo"] = detail_data
    return {
        "code": 0,
        "message": None,
        "data": core_data,
        "recordTime": None,
    }


class _WebSocket:
    def __init__(self, url: str, timeout: float = 10.0):
        parsed = urlsplit(url)
        if parsed.scheme != "ws" or parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise RuntimeError("Chrome 返回了非本机 WebSocket 地址，已拒绝连接")

        port = parsed.port or 80
        self.socket = socket.create_connection((parsed.hostname, port), timeout)
        self.buffer = bytearray()
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {parsed.hostname}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.socket.sendall(request.encode("ascii"))
        response = self._read_headers()
        status_line, *header_lines = response.split("\r\n")
        if " 101 " not in status_line:
            raise RuntimeError(f"Chrome WebSocket 握手失败：{status_line}")
        headers = {
            name.strip().lower(): value.strip()
            for line in header_lines
            if ":" in line
            for name, value in [line.split(":", 1)]
        }
        expected = base64.b64encode(
            hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()
        ).decode("ascii")
        if headers.get("sec-websocket-accept") != expected:
            raise RuntimeError("Chrome WebSocket 握手校验失败")

    def _read_headers(self) -> str:
        marker = b"\r\n\r\n"
        while marker not in self.buffer:
            chunk = self.socket.recv(4096)
            if not chunk:
                raise RuntimeError("Chrome 在 WebSocket 握手期间断开连接")
            self.buffer.extend(chunk)
        index = self.buffer.index(marker)
        raw = bytes(self.buffer[:index])
        del self.buffer[: index + len(marker)]
        return raw.decode("iso-8859-1")

    def _read_exact(self, size: int) -> bytes:
        while len(self.buffer) < size:
            chunk = self.socket.recv(max(4096, size - len(self.buffer)))
            if not chunk:
                raise RuntimeError("Chrome WebSocket 已断开")
            self.buffer.extend(chunk)
        result = bytes(self.buffer[:size])
        del self.buffer[:size]
        return result

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        first = 0x80 | opcode
        length = len(payload)
        if length < 126:
            header = bytes((first, 0x80 | length))
        elif length <= 0xFFFF:
            header = bytes((first, 0x80 | 126)) + struct.pack("!H", length)
        else:
            header = bytes((first, 0x80 | 127)) + struct.pack("!Q", length)
        mask = os.urandom(4)
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.socket.sendall(header + mask + masked)

    def send_text(self, text: str) -> None:
        self._send_frame(0x1, text.encode("utf-8"))

    def receive_text(self, timeout: float) -> str:
        self.socket.settimeout(timeout)
        fragments = bytearray()
        active_opcode = None
        while True:
            first, second = self._read_exact(2)
            finished = bool(first & 0x80)
            opcode = first & 0x0F
            masked = bool(second & 0x80)
            length = second & 0x7F
            if length == 126:
                length = struct.unpack("!H", self._read_exact(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._read_exact(8))[0]
            mask = self._read_exact(4) if masked else None
            payload = self._read_exact(length)
            if mask:
                payload = bytes(
                    value ^ mask[index % 4] for index, value in enumerate(payload)
                )

            if opcode == 0x8:
                raise RuntimeError("Chrome WebSocket 已关闭")
            if opcode == 0x9:
                self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            if opcode in {0x1, 0x2}:
                active_opcode = opcode
                fragments = bytearray(payload)
            elif opcode == 0x0 and active_opcode is not None:
                fragments.extend(payload)
            else:
                continue
            if finished:
                if active_opcode != 0x1:
                    raise RuntimeError("Chrome 返回了非文本 CDP 消息")
                return fragments.decode("utf-8")

    def close(self) -> None:
        try:
            self._send_frame(0x8, b"")
        except Exception:
            pass
        self.socket.close()


class _CdpClient:
    def __init__(self, endpoint: str):
        try:
            with urllib.request.urlopen(endpoint + "/json/version", timeout=5) as response:
                version = json.loads(response.read().decode("utf-8"))
            websocket_url = version["webSocketDebuggerUrl"]
            self.websocket = _WebSocket(websocket_url)
        except Exception as error:
            raise RuntimeError(
                "无法连接当前 Chrome。请确认 Chrome 已使用 "
                "--remote-debugging-port 启动并保持运行。"
                f"原始错误：{error}"
            ) from error
        self.next_id = 0

    def call(
        self,
        method: str,
        params: Optional[Dict[str, Any]] = None,
        session_id: Optional[str] = None,
        timeout: float = 30.0,
    ) -> Dict[str, Any]:
        self.next_id += 1
        command_id = self.next_id
        message: Dict[str, Any] = {
            "id": command_id,
            "method": method,
            "params": params or {},
        }
        if session_id:
            message["sessionId"] = session_id
        self.websocket.send_text(json.dumps(message, separators=(",", ":")))

        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"Chrome CDP 命令超时：{method}")
            response = json.loads(self.websocket.receive_text(remaining))
            if response.get("id") != command_id:
                continue
            if "error" in response:
                detail = response["error"].get("message") or str(response["error"])
                raise RuntimeError(f"Chrome CDP 命令失败 {method}：{detail}")
            return response.get("result", {})

    def evaluate(
        self,
        session_id: str,
        expression: str,
        timeout: float = 30.0,
    ) -> Any:
        result = self.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "awaitPromise": True,
                "returnByValue": True,
            },
            session_id,
            timeout,
        )
        if result.get("exceptionDetails"):
            details = result["exceptionDetails"]
            description = (
                details.get("exception", {}).get("description")
                or details.get("text")
                or "页面脚本执行失败"
            )
            raise RuntimeError(description)
        return result.get("result", {}).get("value")

    def close(self) -> None:
        self.websocket.close()


def _read_local_json(url: str, timeout: float) -> Any:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _read_chromium_processes() -> List[Dict[str, Any]]:
    if os.name != "nt":
        return []
    command = (
        "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"
        "$items=Get-CimInstance Win32_Process -Filter "
        "\"Name='chrome.exe' OR Name='msedge.exe' OR Name='chromium.exe'\" | "
        "Select-Object ProcessId,Name,CommandLine;"
        "@($items)|ConvertTo-Json -Compress"
    )
    try:
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True,
            check=True,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        output = completed.stdout.decode("utf-8-sig").strip()
        if not output:
            return []
        value = json.loads(output)
        return value if isinstance(value, list) else [value]
    except Exception:
        return []


def _extract_process_candidates(
    processes: List[Dict[str, Any]],
) -> List[Tuple[int, str, Optional[str]]]:
    candidates: List[Tuple[int, str, Optional[str]]] = []
    for process in processes:
        command_line = process.get("CommandLine") or ""
        port_match = re.search(
            r"--remote-debugging-port(?:=|\s+)([0-9]+)",
            command_line,
            re.IGNORECASE,
        )
        directory_match = re.search(
            r'--user-data-dir(?:=|\s+)(?:"([^"]+)"|(\S+))',
            command_line,
            re.IGNORECASE,
        )
        profile_dir = (
            (directory_match.group(1) or directory_match.group(2))
            if directory_match
            else None
        )
        process_name = str(process.get("Name") or "")
        if port_match:
            candidates.append((int(port_match.group(1)), process_name, profile_dir))
    return candidates


def _port_from_active_file(profile_dir: Optional[str]) -> Optional[int]:
    if not profile_dir:
        return None
    try:
        first_line = (
            pathlib.Path(os.path.expandvars(profile_dir))
            .joinpath("DevToolsActivePort")
            .read_text(encoding="utf-8")
            .splitlines()[0]
        )
        port = int(first_line)
        return port if 1 <= port <= 65535 else None
    except Exception:
        return None


def _probe_cdp_port(
    port: int, process_name: str = ""
) -> Optional[Dict[str, Any]]:
    if not 1 <= port <= 65535:
        return None
    endpoint = f"http://127.0.0.1:{port}"
    try:
        version = _read_local_json(endpoint + "/json/version", timeout=0.6)
        browser_name = str(version.get("Browser") or "")
        if not version.get("webSocketDebuggerUrl") or not re.search(
            r"Chrome|Chromium|Edg", browser_name, re.IGNORECASE
        ):
            return None
        targets = _read_local_json(endpoint + "/json/list", timeout=0.6)
        has_taobao_page = any(
            re.search(r"(?:taobao|tmall)\.com", str(target.get("url") or ""), re.IGNORECASE)
            for target in targets
        )
        score = (100 if has_taobao_page else 0) + (
            10 if process_name.lower() == "chrome.exe" else 0
        )
        return {
            "endpoint": endpoint,
            "port": port,
            "browser": browser_name,
            "hasTaobaoPage": has_taobao_page,
            "score": score,
        }
    except Exception:
        return None


def _discover_cdp_endpoint() -> str:
    ports: Dict[int, str] = {}
    known_profile = os.environ.get("TAOBAO_RPA_PROFILE", "").strip()
    if not known_profile:
        known_profile = str(
            pathlib.Path(os.environ.get("LOCALAPPDATA", ""))
            / "TaobaoRPA"
            / "ChromeProfile"
        )
    known_port = _port_from_active_file(known_profile)
    if known_port:
        known_browser = _probe_cdp_port(known_port, "chrome.exe")
        if known_browser:
            return known_browser["endpoint"]

    processes = _read_chromium_processes()
    for port, process_name, profile_dir in _extract_process_candidates(processes):
        actual_port = port or _port_from_active_file(profile_dir)
        if actual_port:
            ports[actual_port] = process_name

    override = os.environ.get("CHROME_CDP_URL", "").strip()
    if override:
        parsed = urlsplit(override)
        if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise RuntimeError("CHROME_CDP_URL 只允许指向本机浏览器")
        if parsed.port:
            ports[parsed.port] = ""

    for port in COMMON_CDP_PORTS:
        ports.setdefault(port, "")

    found = []
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=min(8, max(1, len(ports)))
    ) as executor:
        futures = [
            executor.submit(_probe_cdp_port, port, process_name)
            for port, process_name in ports.items()
        ]
        for future in concurrent.futures.as_completed(futures):
            candidate = future.result()
            if candidate is not None:
                found.append(candidate)
    if not found:
        chrome_running = any(
            str(process.get("Name") or "").lower()
            in {"chrome.exe", "msedge.exe", "chromium.exe"}
            and "--type=" not in str(process.get("CommandLine") or "")
            for process in processes
        )
        if chrome_running:
            raise RuntimeError(
                "检测到普通 Chrome 正在运行，但没有发现 RPA 专用 CDP 浏览器。"
                "请先执行“步骤2-启动Chrome-CDP.py”；首次启动后在新浏览器中登录淘宝。"
            )
        raise RuntimeError(
            "没有发现可连接的 Chrome。请先执行“步骤2-启动Chrome-CDP.py”。"
        )

    found.sort(key=lambda item: (item["score"], -item["port"]), reverse=True)
    if len(found) > 1 and found[0]["score"] == found[1]["score"]:
        ports_text = ", ".join(str(item["port"]) for item in found)
        raise RuntimeError(
            f"发现多个可连接浏览器端口（{ports_text}），无法确定已登录账号所在浏览器。"
            "请只保留一个远程调试浏览器，或设置本机环境变量 CHROME_CDP_URL。"
        )
    return found[0]["endpoint"]


def _load_item_page(client: _CdpClient, session_id: str, item_id: str) -> None:
    urls = (
        f"https://item.taobao.com/item.htm?id={item_id}",
        f"https://detail.tmall.com/item.htm?id={item_id}",
    )
    errors: List[str] = []

    for url in urls:
        try:
            navigation = client.call(
                "Page.navigate",
                {"url": url},
                session_id,
                timeout=NAVIGATION_TIMEOUT_MS / 1000,
            )
            if navigation.get("errorText"):
                raise RuntimeError(navigation["errorText"])

            deadline = time.monotonic() + NAVIGATION_TIMEOUT_MS / 1000
            while time.monotonic() < deadline:
                ready = client.evaluate(
                    session_id,
                    "Boolean(window.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res)",
                )
                if ready:
                    break
                time.sleep(0.25)
            else:
                raise TimeoutError("等待淘宝/天猫商品运行时数据超时")

            runtime_item_id = client.evaluate(
                session_id,
                "window.__ICE_APP_CONTEXT__.loaderData.home.data.res.item.itemId",
            )
            if str(runtime_item_id) != item_id:
                raise RuntimeError(
                    f"页面商品 ID {runtime_item_id} 与输入 ID {item_id} 不一致"
                )
            return
        except Exception as error:
            errors.append(str(error))

    reason = errors[-1] if errors else "没有读取到商品数据"
    raise RuntimeError(f"商品页面加载失败：{reason}")


def _parse_with_current_chrome(item_id: str) -> Dict[str, Any]:
    client = _CdpClient(_discover_cdp_endpoint())
    target_id = None
    try:
        target_id = client.call("Target.createTarget", {"url": "about:blank"})[
            "targetId"
        ]
        session_id = client.call(
            "Target.attachToTarget",
            {"targetId": target_id, "flatten": True},
        )["sessionId"]
        _load_item_page(client, session_id, item_id)
        client.evaluate(
            session_id,
            f"({LAZY_LOAD_SCRIPT})()",
            timeout=30,
        )
        time.sleep(2)

        core_data = client.evaluate(session_id, f"({CORE_SCRIPT})()", timeout=60)
        commerce_data = client.evaluate(
            session_id, f"({COMMERCE_SCRIPT})()", timeout=60
        )
        detail_data = client.evaluate(session_id, f"({DETAIL_SCRIPT})()", timeout=60)
        return _build_result(core_data, commerce_data, detail_data)
    finally:
        if target_id is not None:
            try:
                client.call("Target.closeTarget", {"targetId": target_id})
            except Exception:
                pass
        client.close()


def checkChrome() -> Dict[str, Any]:
    """八爪鱼可选校验入口：只检查 Chrome，不创建商品标签页。"""
    try:
        endpoint = _discover_cdp_endpoint()
        version = _read_local_json(endpoint + "/json/version", timeout=3)
        return {
            "code": 0,
            "message": None,
            "data": {
                "connected": True,
                "endpoint": endpoint,
                "browser": version.get("Browser"),
            },
            "recordTime": None,
        }
    except Exception as error:
        return _error_result(error)


def main(itemId: Any) -> Dict[str, Any]:
    """八爪鱼 RPA 入口：输入商品 ID，返回统一淘宝/天猫商品 JSON。"""
    try:
        item_id = _validate_item_id(itemId)
        return _parse_with_current_chrome(item_id)
    except Exception as error:
        return _error_result(error)
