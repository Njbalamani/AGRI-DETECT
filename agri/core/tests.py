import json
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase

from ml.predict import aggregate_predictions, decode_data_url, health_to_risk


BASE_DIR = Path(__file__).resolve().parent.parent
HTML_PAGES = ("index.html", "detection.html", "history.html", "about.html", "settings.html")


PAGE_TESTS = {
    "/": ("Ulavan Tech — Home", 'id="home-grid"'),
    "/index.html": ("Ulavan Tech — Home", 'id="home-grid"'),
    "/detection.html": ("Ulavan Tech — Date Palm Detection", 'id="capture-screen"'),
    "/history.html": ("Ulavan Tech — Inspection History", 'id="history-list"'),
    "/about.html": ("Ulavan Tech — The Project", "Phase 01 · Empathise"),
    "/settings.html": ("Ulavan Tech — AI Settings", 'id="set-gemini-key"'),
}


ASSET_PATHS = [
    "/styles.css",
    "/problems.js",
    "/problems-ta.js",
    "/langs.js",
    "/i18n.js",
    "/app.js",
    "/detection.js",
    "/history.js",
    "/chatbot.js",
    "/chat-key.js",
    "/sw-register.js",
    "/service-worker.js",
    "/manifest.json",
    "/images/01-date-palm.jpg",
    "/icons/icon-192.png",
]


class AgriPageTests(SimpleTestCase):
    def test_pages_render_original_markup(self):
        for url, (title, marker) in PAGE_TESTS.items():
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertContains(response, title)
                self.assertContains(response, marker)

    def test_detection_accepts_crop_query_string(self):
        response = self.client.get("/detection.html?crop=date-palm&name=Date%20Palm")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Guided 360° Capture")

    def test_original_assets_are_served_from_root(self):
        for url in ASSET_PATHS:
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 200)
                payload = b"".join(response.streaming_content)
                self.assertGreater(len(payload), 0)

    def test_service_worker_and_manifest_content_types(self):
        self.assertEqual(self.client.get("/service-worker.js")["Content-Type"], "text/javascript")
        self.assertEqual(self.client.get("/manifest.json")["Content-Type"], "application/json")

    def test_asset_lookup_rejects_parent_traversal(self):
        response = self.client.get("/../manage.py")
        self.assertIn(response.status_code, (301, 400, 404))


class AgriConsistencyTests(SimpleTestCase):
    def test_templates_match_static_markup(self):
        for page in HTML_PAGES:
            with self.subTest(page=page):
                template = (BASE_DIR / "templates" / page).read_text(encoding="utf-8")
                static = (BASE_DIR / "static" / "agri" / page).read_text(encoding="utf-8")
                self.assertEqual(template, static)


class AgriHistorySyncTests(TestCase):
    def _post(self, payload):
        return self.client.post(
            "/api/history/sync",
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_post_and_get_sync(self):
        response = self._post({"records": [{
            "id": "demo-1",
            "crop": "Date Palm",
            "cropId": "date-palm",
            "palmId": "P12",
            "zone": "A",
            "risk": "low",
            "confidence": 80,
            "method": "model",
            "date": "2026-11-21T09:00:00.000Z",
            "updatedAt": 1000,
        }]})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["saved"], 1)
        self.assertEqual(data["records"][0]["palmId"], "P12")
        fetched = self.client.get("/api/history/sync?since=0")
        self.assertEqual(fetched.status_code, 200)
        self.assertTrue(any(r["id"] == "demo-1" for r in fetched.json()["records"]))

    def test_rejects_invalid_payload(self):
        response = self._post({"records": "bad"})
        self.assertEqual(response.status_code, 400)

    def test_older_record_does_not_overwrite_newer(self):
        base = {
            "id": "demo-2",
            "crop": "Date Palm",
            "palmId": "P20",
            "zone": "A",
            "risk": "low",
            "date": "2026-11-21T09:00:00.000Z",
        }
        self._post({"records": [dict(base, zone="A", updatedAt=2000)]})
        self._post({"records": [dict(base, zone="B", updatedAt=1000)]})
        fetched = self.client.get("/api/history/sync?since=0").json()
        record = next(r for r in fetched["records"] if r["id"] == "demo-2")
        self.assertEqual(record["zone"], "A")


class AgriMlLogicTests(SimpleTestCase):
    def test_health_to_risk_boundaries(self):
        self.assertEqual(health_to_risk(0.9)["risk"], "low")
        self.assertEqual(health_to_risk(0.4)["risk"], "medium")
        self.assertEqual(health_to_risk(0.1)["risk"], "high")

    def test_aggregate_predictions_uses_python_model_result(self):
        result = aggregate_predictions([
            {"score": 0.92, "source": "python_model", "error": None},
            {"score": 0.88, "source": "python_model", "error": None},
        ])
        self.assertEqual(result["risk"], "low")
        self.assertEqual(result["method"], "model")
        self.assertTrue(result["model_used"])

    def test_decode_data_url_rejects_invalid_input(self):
        with self.assertRaises(ValueError):
            decode_data_url("not-an-image")


class AgriMlApiTests(SimpleTestCase):
    def test_status_endpoint_reports_python_backend(self):
        response = self.client.get("/api/ml/status")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["backend"], "python")

    def test_predict_rejects_empty_images(self):
        response = self.client.post(
            "/api/ml/predict",
            data=json.dumps({"images": []}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    @patch("core.views.analyse_images")
    def test_predict_returns_python_analysis(self, analyse):
        analyse.return_value = {
            "risk": "low",
            "confidence": 92,
            "score": 0.94,
            "method": "model",
            "model_used": True,
            "disease": None,
        }
        response = self.client.post(
            "/api/ml/predict",
            data=json.dumps({"images": ["data:image/jpeg;base64,QUJD"]}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["risk"], "low")
        self.assertEqual(data["method"], "model")
        analyse.assert_called_once()
