import json
import os
import pathlib
import urllib.parse
import urllib.request


def _profile_dir():
    custom = os.environ.get("TAOBAO_RPA_PROFILE", "").strip()
    if custom:
        return pathlib.Path(os.path.expandvars(custom))
    return pathlib.Path(os.environ["LOCALAPPDATA"]) / "TaobaoRPA" / "ChromeProfile"


def _cdp_endpoint():
    try:
        active_port_file = _profile_dir() / "DevToolsActivePort"
        port = int(active_port_file.read_text(encoding="utf-8").splitlines()[0])
        if not 1 <= port <= 65535:
            return None
        endpoint = "http://127.0.0.1:{0}".format(port)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(endpoint + "/json/version", timeout=2) as response:
            version = json.loads(response.read().decode("utf-8"))
        if not version.get("webSocketDebuggerUrl"):
            return None
        return endpoint
    except Exception:
        return None


def _verify_with_temporary_tab(endpoint):
    target_id = None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        url = endpoint + "/json/new?" + urllib.parse.quote("about:blank", safe="")
        request = urllib.request.Request(url, method="PUT")
        with opener.open(request, timeout=5) as response:
            target = json.loads(response.read().decode("utf-8"))
        target_id = target.get("id")
        return bool(target_id)
    except Exception:
        return False
    finally:
        if target_id:
            try:
                close_url = endpoint + "/json/close/" + urllib.parse.quote(
                    target_id, safe=""
                )
                with opener.open(close_url, timeout=5):
                    pass
            except Exception:
                pass


def main():
    """创建临时标签页检查 CDP，关闭该标签页后返回布尔值。"""
    endpoint = _cdp_endpoint()
    if endpoint is None:
        return False
    return _verify_with_temporary_tab(endpoint)
