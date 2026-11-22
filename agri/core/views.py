import json

from django.conf import settings
from django.db import transaction
from django.http import HttpResponseBadRequest, HttpResponseNotAllowed, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.generic import TemplateView
from django.views.static import serve

from ml import analyse_images, model_status as ml_model_status
from .models import InspectionRecord


def asset(request, path):
    return serve(request, path, document_root=settings.AGRI_STATIC_ROOT, show_indexes=False)


def _as_int(value, default=0):
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _clean_sync_record(raw):
    if not isinstance(raw, dict) or raw.get("id") in (None, ""):
        return None
    updated = _as_int(raw.get("updatedAt"), _as_int(raw.get("followUpAt")))
    return {
        "record_id": str(raw["id"])[:64],
        "crop": str(raw.get("crop") or "")[:200],
        "crop_id": str(raw.get("cropId") or "")[:100],
        "palm_id": str(raw.get("palmId") or "")[:100],
        "zone": str(raw.get("zone") or "")[:100],
        "risk": str(raw.get("risk") or "")[:20],
        "confidence": min(100, max(0, _as_int(raw.get("confidence")))),
        "method": str(raw.get("method") or "")[:20],
        "findings": str(raw.get("findings") or ""),
        "guidance": str(raw.get("guidance") or ""),
        "disease": raw.get("disease") if isinstance(raw.get("disease"), dict) else None,
        "date_client": str(raw.get("date") or "")[:100],
        "follow_up_at": _as_int(raw.get("followUpAt")) or None,
        "follow_up_done": bool(raw.get("followUpDone")),
        "payload": raw,
        "source_updated_at": updated,
    }


@transaction.atomic
def history_sync(request):
    if request.method == "GET":
        since = _as_int(request.GET.get("since"))
        limit = min(200, max(1, _as_int(request.GET.get("limit"), 200)))
        records = InspectionRecord.objects.filter(source_updated_at__gt=since).order_by("source_updated_at")[:limit]
        return JsonResponse({"ok": True, "records": [record.to_sync_dict() for record in records]})

    if request.method != "POST":
        return HttpResponseNotAllowed(["GET", "POST"])

    if _as_int(request.META.get("CONTENT_LENGTH"), 0) > 1000000:
        return HttpResponseBadRequest("payload too large")
    try:
        data = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return HttpResponseBadRequest("invalid JSON")
    if not isinstance(data, dict) or not isinstance(data.get("records"), list):
        return HttpResponseBadRequest("records must be a list")
    if len(data["records"]) > 200:
        return HttpResponseBadRequest("too many records")

    saved = []
    for raw in data["records"]:
        clean = _clean_sync_record(raw)
        if not clean:
            continue
        existing = InspectionRecord.objects.filter(record_id=clean["record_id"]).first()
        if existing and existing.source_updated_at > clean["source_updated_at"]:
            saved.append(existing)
            continue
        record, _ = InspectionRecord.objects.update_or_create(
            record_id=clean["record_id"],
            defaults=clean,
        )
        saved.append(record)

    records = InspectionRecord.objects.all().order_by("-source_updated_at")[:200]
    return JsonResponse({"ok": True, "saved": len(saved), "records": [record.to_sync_dict() for record in records]})


def ml_status(request):
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    return JsonResponse({"ok": True, **ml_model_status()})


@csrf_exempt
def ml_predict(request):
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    if _as_int(request.META.get("CONTENT_LENGTH"), 0) > 3000000:
        return HttpResponseBadRequest("payload too large")
    try:
        data = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return HttpResponseBadRequest("invalid JSON")
    if not isinstance(data, dict) or not isinstance(data.get("images"), list):
        return HttpResponseBadRequest("images must be a list")
    if not data["images"] or len(data["images"]) > 6:
        return HttpResponseBadRequest("provide between 1 and 6 images")
    try:
        result = analyse_images(data["images"])
    except ValueError as exc:
        return HttpResponseBadRequest(str(exc))
    return JsonResponse({"ok": True, **result})


home = TemplateView.as_view(template_name="index.html")
detection = TemplateView.as_view(template_name="detection.html")
history = TemplateView.as_view(template_name="history.html")
about = TemplateView.as_view(template_name="about.html")
settings_page = TemplateView.as_view(template_name="settings.html")
