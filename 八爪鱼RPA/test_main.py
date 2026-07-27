import importlib.util
import inspect
import pathlib
import tempfile
import unittest

MODULE_PATH = pathlib.Path(__file__).with_name("main.py")
SPEC = importlib.util.spec_from_file_location("octopus_rpa_main", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def load_sibling(filename, module_name):
    path = pathlib.Path(__file__).with_name(filename)
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


CHECK_MODULE = load_sibling("步骤1-检查CDP.py", "octopus_rpa_check_cdp")
START_MODULE = load_sibling("步骤2-启动Chrome-CDP.py", "octopus_rpa_start_chrome")


class RpaParserTests(unittest.TestCase):
    def test_cdp_check_closes_the_exact_temporary_target(self):
        calls = []

        class FakeResponse:
            def __init__(self, body=b"{}"):
                self.body = body

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def read(self):
                return self.body

        class FakeOpener:
            def open(self, request, timeout):
                url = request.full_url if hasattr(request, "full_url") else request
                calls.append(url)
                if "/json/new?" in url:
                    return FakeResponse(b'{"id":"temporary-target-123"}')
                return FakeResponse()

        original_builder = CHECK_MODULE.urllib.request.build_opener
        try:
            CHECK_MODULE.urllib.request.build_opener = lambda *handlers: FakeOpener()
            result = CHECK_MODULE._verify_with_temporary_tab(
                "http://127.0.0.1:9222"
            )
        finally:
            CHECK_MODULE.urllib.request.build_opener = original_builder

        self.assertIs(result, True)
        self.assertTrue(any("/json/new?about%3Ablank" in url for url in calls))
        self.assertIn(
            "http://127.0.0.1:9222/json/close/temporary-target-123",
            calls,
        )

    def test_step_functions_have_no_input_and_return_booleans(self):
        self.assertEqual(list(inspect.signature(CHECK_MODULE.main).parameters), [])
        self.assertEqual(list(inspect.signature(START_MODULE.main).parameters), [])

        original_check = CHECK_MODULE._cdp_endpoint
        original_verify = CHECK_MODULE._verify_with_temporary_tab
        original_start = START_MODULE._cdp_endpoint
        original_open = START_MODULE._open_taobao
        try:
            CHECK_MODULE._cdp_endpoint = lambda: "http://127.0.0.1:12345"
            CHECK_MODULE._verify_with_temporary_tab = lambda endpoint: True
            self.assertIs(CHECK_MODULE.main(), True)
            CHECK_MODULE._cdp_endpoint = lambda: None
            self.assertIs(CHECK_MODULE.main(), False)

            opened = []
            START_MODULE._cdp_endpoint = lambda: "http://127.0.0.1:12345"
            START_MODULE._open_taobao = opened.append
            self.assertIs(START_MODULE.main(), True)
            self.assertEqual(opened, ["http://127.0.0.1:12345"])
        finally:
            CHECK_MODULE._cdp_endpoint = original_check
            CHECK_MODULE._verify_with_temporary_tab = original_verify
            START_MODULE._cdp_endpoint = original_start
            START_MODULE._open_taobao = original_open

    def test_start_step_uses_dynamic_cdp_profile_and_taobao_url(self):
        calls = []
        endpoint_results = iter([None, "http://127.0.0.1:23456"])
        original_endpoint = START_MODULE._cdp_endpoint
        original_find = START_MODULE._find_chrome
        original_popen = START_MODULE.subprocess.Popen
        original_profile = START_MODULE.os.environ.get("TAOBAO_RPA_PROFILE")
        try:
            with tempfile.TemporaryDirectory() as profile:
                START_MODULE.os.environ["TAOBAO_RPA_PROFILE"] = profile
                START_MODULE._cdp_endpoint = lambda: next(endpoint_results)
                START_MODULE._find_chrome = lambda: r"C:\Chrome\chrome.exe"
                START_MODULE.subprocess.Popen = (
                    lambda args, **kwargs: calls.append((args, kwargs))
                )
                self.assertIs(START_MODULE.main(), True)
        finally:
            START_MODULE._cdp_endpoint = original_endpoint
            START_MODULE._find_chrome = original_find
            START_MODULE.subprocess.Popen = original_popen
            if original_profile is None:
                START_MODULE.os.environ.pop("TAOBAO_RPA_PROFILE", None)
            else:
                START_MODULE.os.environ["TAOBAO_RPA_PROFILE"] = original_profile

        args = calls[0][0]
        self.assertIn("--remote-debugging-port=0", args)
        self.assertIn("--remote-debugging-address=127.0.0.1", args)
        self.assertIn("https://www.taobao.com/", args)
        self.assertTrue(any(value.startswith("--user-data-dir=") for value in args))

    def test_start_step_records_a_diagnostic_when_chrome_is_missing(self):
        original_endpoint = START_MODULE._cdp_endpoint
        original_find = START_MODULE._find_chrome
        original_error_file = START_MODULE._error_file
        try:
            with tempfile.TemporaryDirectory() as directory:
                error_file = pathlib.Path(directory) / "start-error.txt"
                START_MODULE._cdp_endpoint = lambda: None
                START_MODULE._find_chrome = lambda: None
                START_MODULE._error_file = lambda: error_file
                self.assertIs(START_MODULE.main(), False)
                self.assertIn(
                    "Chrome was not found",
                    error_file.read_text(encoding="utf-8"),
                )
        finally:
            START_MODULE._cdp_endpoint = original_endpoint
            START_MODULE._find_chrome = original_find
            START_MODULE._error_file = original_error_file

    def test_rpa_entry_is_main_with_item_id_parameter(self):
        self.assertEqual(list(inspect.signature(MODULE.main).parameters), ["itemId"])

    def test_accepts_string_integer_and_integral_float_item_ids(self):
        self.assertEqual(MODULE._validate_item_id(" 901024796701 "), "901024796701")
        self.assertEqual(MODULE._validate_item_id(901024796701), "901024796701")
        self.assertEqual(MODULE._validate_item_id(901024796701.0), "901024796701")

    def test_rejects_invalid_item_ids_without_connecting_to_chrome(self):
        result = MODULE.main("abc")
        self.assertEqual(result["code"], 1)
        self.assertIsNone(result["data"])
        self.assertIn("商品 ID 格式不正确", result["message"])

    def test_preserves_required_output_order(self):
        core = {
            "shopInfo": {"shopId": "1"},
            "spuInfo": {"itemId": 1, "title": "x", "media": {}},
            "skuInfo": {"items": []},
        }
        result = MODULE._build_result(
            core,
            {"priceInfo": {"currency": "CNY"}},
            {"imageTextInfo": {"images": []}},
        )
        self.assertEqual(
            list(result["data"]),
            ["shopInfo", "spuInfo", "skuInfo", "detailPageInfo"],
        )
        self.assertIn("priceInfo", result["data"]["spuInfo"])

    def test_extracts_fixed_and_dynamic_debugging_candidates(self):
        processes = [
            {
                "Name": "chrome.exe",
                "CommandLine": (
                    'chrome.exe --remote-debugging-port=9333 '
                    '--user-data-dir="C:\\tmp\\profile-one"'
                ),
            },
            {
                "Name": "chrome.exe",
                "CommandLine": (
                    'chrome.exe --remote-debugging-port=0 '
                    '--user-data-dir="C:\\tmp\\profile-two"'
                ),
            },
        ]
        self.assertEqual(
            MODULE._extract_process_candidates(processes),
            [
                (9333, "chrome.exe", "C:\\tmp\\profile-one"),
                (0, "chrome.exe", "C:\\tmp\\profile-two"),
            ],
        )

    def test_parse_creates_and_closes_only_its_own_target(self):
        class FakeClient:
            def __init__(self):
                self.calls = []
                self.evaluations = 0
                self.closed = False

            def call(self, method, params=None, session_id=None, timeout=30):
                self.calls.append((method, params, session_id))
                if method == "Target.createTarget":
                    return {"targetId": "created-by-this-task"}
                if method == "Target.attachToTarget":
                    return {"sessionId": "task-session"}
                if method == "Target.closeTarget":
                    return {"success": True}
                return {}

            def evaluate(self, session_id, expression, timeout=30):
                self.evaluations += 1
                if self.evaluations == 1:
                    return None
                if self.evaluations == 2:
                    return {
                        "shopInfo": {},
                        "spuInfo": {"itemId": 1, "title": "x", "media": {}},
                        "skuInfo": {},
                    }
                return {}

            def close(self):
                self.closed = True

        fake = FakeClient()
        original_client = MODULE._CdpClient
        original_discover = MODULE._discover_cdp_endpoint
        original_loader = MODULE._load_item_page
        original_sleep = MODULE.time.sleep
        try:
            MODULE._CdpClient = lambda endpoint: fake
            MODULE._discover_cdp_endpoint = lambda: "http://127.0.0.1:12345"
            MODULE._load_item_page = lambda client, session_id, item_id: None
            MODULE.time.sleep = lambda seconds: None
            result = MODULE._parse_with_current_chrome("901024796701")
        finally:
            MODULE._CdpClient = original_client
            MODULE._discover_cdp_endpoint = original_discover
            MODULE._load_item_page = original_loader
            MODULE.time.sleep = original_sleep

        self.assertEqual(result["code"], 0)
        self.assertIn(
            (
                "Target.closeTarget",
                {"targetId": "created-by-this-task"},
                None,
            ),
            fake.calls,
        )
        self.assertTrue(fake.closed)


if __name__ == "__main__":
    unittest.main()
