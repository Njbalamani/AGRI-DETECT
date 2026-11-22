import argparse
import base64
import binascii
import csv
import hashlib
import json
import re
from pathlib import Path

MANIFEST_FIELDS = ["id", "file", "label", "risk", "confidence", "method", "ts"]
SAFE_NAME_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")
WHITESPACE_PATTERN = re.compile(r"\s+")
WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "CONIN$",
    "CONOUT$",
}


def label_for(record):
    if not isinstance(record, dict):
        return None
    risk = record.get("risk")
    if risk == "no_plant":
        return None
    correct = record.get("correct")
    if not isinstance(correct, bool):
        return None
    if risk == "low":
        return "healthy" if correct else "diseased"
    if risk in ("medium", "high"):
        return "diseased" if correct else "healthy"
    return None


def extract_base64(value):
    if not isinstance(value, str):
        return ""
    text = value.strip()
    if text.startswith("data:") and "," in text:
        text = text.split(",", 1)[1].strip()
    return WHITESPACE_PATTERN.sub("", text)


def normalise_record(record):
    if not isinstance(record, dict):
        return None
    label = label_for(record)
    if label is None:
        return None
    record_id = record.get("id")
    if record_id is None:
        return None
    record_id = str(record_id).strip()
    if not record_id:
        return None
    image = extract_base64(record.get("image"))
    if not image:
        return None
    return {
        "id": record_id,
        "label": label,
        "image": image,
        "risk": record.get("risk"),
        "confidence": record.get("confidence"),
        "method": record.get("method"),
        "ts": record.get("ts"),
    }


def decode_image(image):
    try:
        return base64.b64decode(image, validate=True)
    except (binascii.Error, ValueError):
        return None


def is_reserved_name(name):
    stem = name.split(".", 1)[0].upper()
    if stem in WINDOWS_RESERVED_NAMES:
        return True
    return len(stem) == 4 and stem[:3] in ("COM", "LPT") and stem[3].isdigit()


def safe_filename(value):
    original = str(value)
    cleaned = SAFE_NAME_PATTERN.sub("_", original).strip("._")
    if not cleaned or is_reserved_name(cleaned):
        cleaned = "record"
    changed = cleaned != original
    base = cleaned[:120].strip("._") or "record"
    if changed:
        digest = hashlib.sha256(original.encode("utf-8")).hexdigest()[:10]
        return f"{base}_{digest}"
    return base


def main(argv=None):
    parser = argparse.ArgumentParser(description="Prepare feedback dataset from NDJSON")
    parser.add_argument("--input", default="ulavan-train-data.ndjson")
    parser.add_argument("--output", default="dataset/feedback")
    args = parser.parse_args(argv)

    input_path = Path(args.input)
    output_path = Path(args.output)
    manifest_path = output_path / "manifest.csv"

    try:
        input_handle = input_path.open("r", encoding="utf-8", errors="replace")
    except OSError as exc:
        print(f"Error: cannot read input file '{input_path}': {exc}")
        return 1

    try:
        output_path.mkdir(parents=True, exist_ok=True)
        manifest_handle = manifest_path.open("w", newline="", encoding="utf-8")
    except OSError as exc:
        input_handle.close()
        print(f"Error: cannot write output directory '{output_path}': {exc}")
        return 1

    accepted = 0
    skipped = 0

    try:
        with input_handle, manifest_handle:
            writer = csv.writer(manifest_handle)
            writer.writerow(MANIFEST_FIELDS)
            for line in input_handle:
                if not line.strip():
                    skipped += 1
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    skipped += 1
                    continue
                item = normalise_record(record)
                if item is None:
                    skipped += 1
                    continue
                image_bytes = decode_image(item["image"])
                if image_bytes is None:
                    skipped += 1
                    continue
                filename = safe_filename(item["id"]) + ".jpg"
                label_dir = output_path / "images" / item["label"]
                relative_file = str(Path("images") / item["label"] / filename).replace("\\", "/")
                try:
                    label_dir.mkdir(parents=True, exist_ok=True)
                    (label_dir / filename).write_bytes(image_bytes)
                except OSError:
                    skipped += 1
                    continue
                writer.writerow([
                    item["id"],
                    relative_file,
                    item["label"],
                    item["risk"],
                    item["confidence"],
                    item["method"],
                    item["ts"],
                ])
                accepted += 1
    except OSError as exc:
        print(f"Error: failed while writing dataset: {exc}")
        return 1

    print(f"Accepted: {accepted}")
    print(f"Skipped: {skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
