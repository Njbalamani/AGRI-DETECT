import argparse
from pathlib import Path

from .train import IMAGE_EXTENSIONS, CLASS_NAMES


def validate_dataset(data_dir):
    for name in CLASS_NAMES:
        class_dir = data_dir / name
        if not class_dir.is_dir():
            raise ValueError(f"missing class folder: {class_dir}")
        files = [
            path for path in class_dir.rglob("*")
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        ]
        if not files:
            raise ValueError(f"no images found in {class_dir}")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Evaluate the Python health model")
    parser.add_argument("--data", default="dataset/health")
    parser.add_argument("--model", default="ml_models/health.keras")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--image-size", type=int, default=96)
    args = parser.parse_args(argv)

    data_dir = Path(args.data)
    model_path = Path(args.model)
    try:
        validate_dataset(data_dir)
    except ValueError as exc:
        print(f"Error: {exc}")
        return 1
    if not model_path.exists():
        print(f"Error: model not found at {model_path}")
        return 1

    try:
        import tensorflow as tf
    except Exception as exc:
        print("Error: TensorFlow is unavailable. Install requirements-ml.txt first.")
        print(f"Details: {exc}")
        return 1

    dataset = tf.keras.utils.image_dataset_from_directory(
        str(data_dir),
        labels="inferred",
        label_mode="binary",
        class_names=CLASS_NAMES,
        color_mode="rgb",
        image_size=(args.image_size, args.image_size),
        batch_size=args.batch_size,
        shuffle=False,
    ).prefetch(tf.data.AUTOTUNE)
    try:
        model = tf.keras.models.load_model(model_path)
        loss, accuracy = model.evaluate(dataset, verbose=0)
    except Exception as exc:
        print(f"Error: evaluation failed: {exc}")
        return 1

    print(f"Loss: {loss:.4f}")
    print(f"Accuracy: {accuracy * 100:.2f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
