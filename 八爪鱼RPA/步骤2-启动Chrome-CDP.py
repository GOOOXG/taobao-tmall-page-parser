import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import time
import traceback
import urllib.parse
import urllib.request

try:
    import winreg
except ImportError:
    winreg = None


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
        os.environ.get("ProgramW6432"),
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

    path_chrome = shutil.which("chrome.exe") or shutil.which("chrome")
    if path_chrome:
        return path_chrome

    if winreg is not None:
        registry_locations = (
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
        )
        for root, key_path in registry_locations:
            try:
                with winreg.OpenKey(root, key_path) as key:
                    candidate = winreg.QueryValue(key, None)
                if candidate and pathlib.Path(candidate).is_file():
                    return candidate
            except OSError:
                pass
    return None


def _error_file():
    return pathlib.Path(tempfile.gettempdir()) / "taobao-rpa-cdp-start-error.txt"


def _clear_error():
    try:
        _error_file().unlink()
    except FileNotFoundError:
        pass


def _record_error(message):
    try:
        _error_file().write_text(str(message), encoding="utf-8")
    except Exception:
        pass


def _open_taobao(endpoint):
    query = urllib.parse.quote(TAOBAO_URL, safe="")
    request = urllib.request.Request(endpoint + "/json/new?" + query, method="PUT")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=5):
        pass


def main():
    """启动带动态 CDP 的 Chrome 并打开淘宝，成功返回 True。"""
    _clear_error()
    try:
        endpoint = _cdp_endpoint()
        if endpoint:
            _open_taobao(endpoint)
            return True

        chrome = _find_chrome()
        if not chrome:
            raise RuntimeError("Google Chrome was not found on this computer.")

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
        process = subprocess.Popen(
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
        raise RuntimeError(
            "Chrome started but CDP was not ready within 20 seconds. "
            "chrome={0}; profile={1}; exitCode={2}".format(
                chrome, profile, process.poll()
            )
        )
    except Exception as error:
        detail = "{0}\n\n{1}".format(error, traceback.format_exc())
        _record_error(detail)
        print("Chrome CDP start failed: {0}".format(error))
        return False
