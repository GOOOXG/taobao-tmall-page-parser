import json
import os
import pathlib
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


def main():
    """CDP 已开启返回 True，否则返回 False。"""
    return _cdp_endpoint() is not None
