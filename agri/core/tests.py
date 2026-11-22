import json
from pathlib import Path

from django.test import SimpleTestCase, TestCase


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
    "/vendor/tf.min.js",
    "/models/plant-health/model.json",
    "/models/plant-health/group1-shard1of2.bin",
    "/models/plant-health/group1-shard2of2.bin",
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
