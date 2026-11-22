import base64
import binascii
import io
import json
import os
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

MODEL_VERSION = "py43"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_HEALTH_MODEL = PROJECT_ROOT / "ml_models" / "health.keras"
DEFAULT_DISEASE_MODEL = PROJECT_ROOT / "ml_models" / "disease.keras"
DEFAULT_DISEASE_CLASSES = PROJECT_ROOT / "ml_models" / "disease_classes.json"


def clamp(value, low=0.0, high=1.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = low
    return max(low, min(high, number))


def decode_data_url(data_url):
    if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
        raise ValueError("invalid image data URL")
    header, separator, payload = data_url.partition(",")
    if not separator or "base64" not in header:
        raise ValueError("invalid image data URL")
    try:
        return base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("invalid base64 image") from exc


def image_array(data_url, size=96):
    image = Image.open(io.BytesIO(decode_data_url(data_url))).convert("RGB")
    image = image.resize((size, size), Image.Resampling.LANCZOS)
    return np.asarray(image, dtype=np.float32)


def preprocess_image(data_url, size=96):
    array = image_array(data_url, size) / 127.5 - 1.0
    return array[np.newaxis, :, :, :]


def configured_path(env_name, default):
    return Path(os.environ.get(env_name, str(default)))


@lru_cache(maxsize=4)
def load_keras_model(path_string):
    path = Path(path_string)
    if not path.exists():
        return None, "model file not found"
    try:
        import tensorflow as tf
    except Exception as exc:
        return None, f"TensorFlow unavailable: {exc}"
    try:
        return tf.keras.models.load_model(path), None
    except Exception as exc:
        return None, f"model load failed: {exc}"


def clear_model_cache():
    load_keras_model.cache_clear()


def health_signal(data_url):
    array = image_array(data_url, 96) / 255.0
    red, green, blue = array[:, :, 0], array[:, :, 1], array[:, :, 2]
    foliage = (green > 0.16) & (green > red * 1.06) & (green > blue * 1.04)
    necrosis = (red > 0.18) & (red > green * 1.12) & (red > blue * 1.10)
    green_ratio = float(foliage.mean())
    brown_ratio = float(necrosis.mean())
    score = 0.52 + green_ratio * 0.42 - brown_ratio * 0.62
    if green_ratio < 0.02:
        score = min(score, 0.18)
    return clamp(score)


def predict_health(data_url):
    path = configured_path("AGRI_HEALTH_MODEL", DEFAULT_HEALTH_MODEL)
    model, error = load_keras_model(str(path))
    if model is not None:
        try:
            output = model.predict(preprocess_image(data_url), verbose=0)
            values = np.asarray(output).reshape(-1)
            score = clamp(values[0] if values.size else 0.5)
            return {"score": score, "source": "python_model", "model": str(path), "error": None}
        except Exception as exc:
            error = f"inference failed: {exc}"
    try:
        score = health_signal(data_url)
        signal_error = None
    except Exception as exc:
        score = 0.5
        signal_error = f"image analysis failed: {exc}"
    return {
        "score": score,
        "source": "python_signal",
        "model": None,
        "error": error or signal_error,
    }


def predict_batch(data_urls, limit=6):
    if not isinstance(data_urls, list):
        raise ValueError("images must be a list")
    if len(data_urls) > limit:
        raise ValueError(f"maximum {limit} images allowed")
    results = []
    for data_url in data_urls:
        try:
            results.append(predict_health(data_url))
        except Exception as exc:
            results.append({"score": 0.5, "source": "python_signal", "model": None, "error": str(exc)})
    return results


def health_to_risk(score):
    value = clamp(score)
    if value >= 0.55:
        return {"risk": "low", "confidence": min(100, 60 + round((value - 0.55) * 80))}
    if value >= 0.30:
        return {"risk": "medium", "confidence": min(100, 55 + round((value - 0.30) * 120))}
    return {"risk": "high", "confidence": min(100, 60 + round((1 - value) * 100))}


def aggregate_predictions(predictions):
    if not predictions:
        return {
            "risk": "high",
            "confidence": 35,
            "score": 0,
            "method": "local",
            "model_used": False,
            "error": "no images analysed",
        }
    scores = [clamp(item.get("score")) for item in predictions]
    average = float(np.mean(scores))
    verdict = health_to_risk(average)
    spread = max(scores) - min(scores)
    confidence = max(35, min(100, verdict["confidence"] - round(spread * 30)))
    model_used = any(item.get("source") == "python_model" for item in predictions)
    errors = [item.get("error") for item in predictions if item.get("error")]
    return {
        "risk": verdict["risk"],
        "confidence": confidence,
        "score": average,
        "method": "model" if model_used else "local",
        "model_used": model_used,
        "error": errors[0] if errors else None,
    }


def predict_disease(data_url):
    model_path = configured_path("AGRI_DISEASE_MODEL", DEFAULT_DISEASE_MODEL)
    classes_path = configured_path("AGRI_DISEASE_CLASSES", DEFAULT_DISEASE_CLASSES)
    model, error = load_keras_model(str(model_path))
    if model is None or not classes_path.exists():
        return None
    try:
        class_names = json.loads(classes_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(class_names, list) or not class_names:
        return None
    try:
        output = model.predict(preprocess_image(data_url, 224), verbose=0)
        values = np.asarray(output).reshape(-1)
        if not values.size:
            return None
        best = int(np.argmax(values))
        return {
            "name": str(class_names[best]) if best < len(class_names) else "unknown",
            "confidence": clamp(values[best]),
        }
    except Exception:
        return None


def model_status():
    health_path = configured_path("AGRI_HEALTH_MODEL", DEFAULT_HEALTH_MODEL)
    disease_path = configured_path("AGRI_DISEASE_MODEL", DEFAULT_DISEASE_MODEL)
    health_model, health_error = load_keras_model(str(health_path))
    disease_model, disease_error = load_keras_model(str(disease_path))
    class_names = []
    classes_path = configured_path("AGRI_DISEASE_CLASSES", DEFAULT_DISEASE_CLASSES)
    if classes_path.exists():
        try:
            loaded = json.loads(classes_path.read_text(encoding="utf-8"))
            if isinstance(loaded, list):
                class_names = [str(name) for name in loaded]
        except Exception:
            class_names = []
    return {
        "version": MODEL_VERSION,
        "backend": "python",
        "health_model": health_model is not None,
        "disease_model": disease_model is not None,
        "health_model_path": str(health_path),
        "disease_model_path": str(disease_path),
        "health_error": health_error,
        "disease_error": disease_error,
        "disease_classes": class_names,
    }


def analyse_images(data_urls):
    predictions = predict_batch(data_urls)
    verdict = aggregate_predictions(predictions)
    disease = None
    if verdict["risk"] != "no_plant" and data_urls:
        disease = predict_disease(data_urls[0])
    verdict["disease"] = disease
    verdict["details"] = [
        {"score": item["score"], "source": item["source"]}
        for item in predictions
    ]
    return verdict
