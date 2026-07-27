import json
import os
import pathlib
import subprocess
import time
import urllib.parse
import urllib.request


TAOBAO_URL = "https://www.taobao.com/"


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
        return endpoint if version.get("webSocketDebuggerUrl") else None
    except Exception:
        return None


def _find_chrome():
    roots = (
        os.environ.get("ProgramFiles"),
        os.environ.get("ProgramFiles(x86)"),
        os.environ.get("LOCALAPPDATA"),
    )
    for root in roots:
        if not root:
            continue
        candidate = pathlib.Path(root) / "Google" / "Chrome" / "Application" / "chrome.exe"
        if candidate.is_file():
            return str(candidate)
    return None


def _open_taobao(endpoint):
    query = urllib.parse.quote(TAOBAO_URL, safe="")
    request = urllib.request.Request(endpoint + "/json/new?" + query, method="PUT")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=5):
        pass


def main():
    """启动带动态 CDP 的 Chrome 并打开淘宝，成功返回 True。"""
    try:
        endpoint = _cdp_endpoint()
        if endpoint:
            _open_taobao(endpoint)
            return True

        chrome = _find_chrome()
        if not chrome:
            return False

        profile = _profile_dir()
        profile.mkdir(parents=True, exist_ok=True)
        active_port_file = profile / "DevToolsActivePort"
        try:
            active_port_file.unlink()
        except FileNotFoundError:
            pass

        creation_flags = 0
        if os.name == "nt":
            creation_flags = (
                getattr(subprocess, "DETACHED_PROCESS", 0)
                | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            )
        subprocess.Popen(
            [
                chrome,
                "--remote-debugging-port=0",
                "--remote-debugging-address=127.0.0.1",
                "--user-data-dir={0}".format(profile),
                "--no-first-run",
                "--no-default-browser-check",
                TAOBAO_URL,
            ],
            close_fds=True,
            creationflags=creation_flags,
        )

        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if _cdp_endpoint():
                return True
            time.sleep(0.25)
        return False
    except Exception:
        return False
