import importlib.util
import inspect
import pathlib
import unittest

MODULE_PATH = pathlib.Path(__file__).with_name("main.py")
SPEC = importlib.util.spec_from_file_location("octopus_rpa_main", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class RpaParserTests(unittest.TestCase):
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
