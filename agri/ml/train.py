import argparse
import json
from pathlib import Path

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
CLASS_NAMES = ["healthy", "diseased"]


def validate_dataset(data_dir):
    missing = [name for name in CLASS_NAMES if not (data_dir / name).is_dir()]
    if missing:
        raise ValueError("missing class folders: " + ", ".join(missing))
    for name in CLASS_NAMES:
        files = [
            path for path in (data_dir / name).rglob("*")
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        ]
        if not files:
            raise ValueError(f"no images found in {data_dir / name}")
    return CLASS_NAMES


def main(argv=None):
    parser = argparse.ArgumentParser(description="Train the Python health model")
    parser.add_argument("--data", default="dataset/health")
    parser.add_argument("--output", default="ml_models/health.keras")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--image-size", type=int, default=96)
    parser.add_argument("--validation-split", type=float, default=0.2)
    args = parser.parse_args(argv)

    if args.epochs <= 0 or args.batch_size <= 0 or args.image_size <= 0:
        print("Error: --epochs, --batch-size and --image-size must be positive.")
        return 1
    if not 0 < args.validation_split < 1:
        print("Error: --validation-split must be between 0 and 1.")
        return 1

    data_dir = Path(args.data)
    output_path = Path(args.output)
    try:
        validate_dataset(data_dir)
    except ValueError as exc:
        print(f"Error: {exc}")
        return 1

    try:
        import tensorflow as tf
    except Exception as exc:
        print("Error: TensorFlow is unavailable. Install requirements-ml.txt first.")
        print(f"Details: {exc}")
        return 1

    train_ds = tf.keras.utils.image_dataset_from_directory(
        str(data_dir),
        labels="inferred",
        label_mode="binary",
        class_names=CLASS_NAMES,
        color_mode="rgb",
        image_size=(args.image_size, args.image_size),
        batch_size=args.batch_size,
        validation_split=args.validation_split,
        subset="training",
        seed=42,
    )
    val_ds = tf.keras.utils.image_dataset_from_directory(
        str(data_dir),
        labels="inferred",
        label_mode="binary",
        class_names=CLASS_NAMES,
        color_mode="rgb",
        image_size=(args.image_size, args.image_size),
        batch_size=args.batch_size,
        validation_split=args.validation_split,
        subset="validation",
        seed=42,
    )
    autotune = tf.data.AUTOTUNE
    train_ds = train_ds.prefetch(autotune)
    val_ds = val_ds.prefetch(autotune)

    base = tf.keras.applications.MobileNetV2(
        input_shape=(args.image_size, args.image_size, 3),
        include_top=False,
        weights="imagenet",
    )
    base.trainable = False
    inputs = tf.keras.Input(shape=(args.image_size, args.image_size, 3))
    x = tf.keras.applications.mobilenet_v2.preprocess_input(inputs)
    x = base(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.2)(x)
    outputs = tf.keras.layers.Dense(1, activation="sigmoid")(x)
    model = tf.keras.Model(inputs, outputs)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(),
        loss="binary_crossentropy",
        metrics=["accuracy"],
    )

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        model.fit(train_ds, validation_data=val_ds, epochs=args.epochs)
        model.save(output_path)
        labels_path = output_path.with_name("health_classes.json")
        labels_path.write_text(json.dumps(CLASS_NAMES, indent=2) + "\n", encoding="utf-8")
    except Exception as exc:
        print(f"Error: training or save failed: {exc}")
        return 1

    print(f"Saved Python model: {output_path}")
    print(f"Saved class labels: {labels_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
