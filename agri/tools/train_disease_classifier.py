import argparse
import json
import shutil
import subprocess
from pathlib import Path

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp"}


def image_files_for_class(class_dir):
    return [
        path
        for path in class_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    ]


def validate_data_dir(data_path):
    if not data_path.exists() or not data_path.is_dir():
        print(f"Error: data directory '{data_path}' does not exist.")
        print(f"Create class folders under it, for example '{data_path / 'healthy'}' and '{data_path / 'diseased'}', each containing images.")
        return None

    class_dirs = sorted(
        (path for path in data_path.iterdir() if path.is_dir()),
        key=lambda path: path.name.lower(),
    )
    if len(class_dirs) < 2:
        print(f"Error: found fewer than 2 class directories in '{data_path}'.")
        print("Create at least two subdirectories, each containing images, then rerun.")
        return None

    class_names = []
    empty_classes = []
    total_images = 0
    for class_dir in class_dirs:
        files = image_files_for_class(class_dir)
        total_images += len(files)
        class_names.append(class_dir.name)
        if not files:
            empty_classes.append(class_dir.name)

    if total_images == 0:
        print(f"Error: no images found in class directories under '{data_path}'.")
        print("Add .jpg, .jpeg, .png, .bmp, .gif, or .webp images to each class directory, then rerun.")
        return None

    if empty_classes:
        names = ", ".join(empty_classes)
        print(f"Error: these class directories contain no images: {names}")
        print("Add at least one image to every class directory, then rerun.")
        return None

    return class_names


def remove_path(path):
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Train a MobileNetV2 disease classifier")
    parser.add_argument("--data", default="dataset/disease")
    parser.add_argument("--output", default="static/agri/models/disease")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--image-size", type=int, default=224)
    args = parser.parse_args(argv)

    if args.epochs <= 0 or args.batch_size <= 0 or args.image_size <= 0:
        print("Error: --epochs, --batch-size, and --image-size must be positive integers.")
        return 1

    data_path = Path(args.data)
    output_path = Path(args.output)
    class_names = validate_data_dir(data_path)
    if class_names is None:
        return 1

    try:
        import tensorflow as tf
    except Exception as exc:
        print("Error: TensorFlow is not available. Install it with 'python -m pip install tensorflow' and rerun.")
        print(f"Details: {exc}")
        return 1

    print(f"Found {len(class_names)} classes: {', '.join(class_names)}")

    try:
        train_ds = tf.keras.utils.image_dataset_from_directory(
            str(data_path),
            labels="inferred",
            label_mode="int",
            class_names=class_names,
            color_mode="rgb",
            image_size=(args.image_size, args.image_size),
            batch_size=args.batch_size,
            shuffle=True,
            seed=42,
        )
        train_ds = train_ds.prefetch(buffer_size=tf.data.AUTOTUNE)
    except Exception as exc:
        print(f"Error: could not load images from '{data_path}': {exc}")
        return 1

    try:
        base_model = tf.keras.applications.MobileNetV2(
            input_shape=(args.image_size, args.image_size, 3),
            include_top=False,
            weights="imagenet",
        )
        base_model.trainable = False
        inputs = tf.keras.Input(shape=(args.image_size, args.image_size, 3))
        x = tf.keras.applications.mobilenet_v2.preprocess_input(inputs)
        x = base_model(x, training=False)
        x = tf.keras.layers.GlobalAveragePooling2D()(x)
        x = tf.keras.layers.Dropout(0.2)(x)
        outputs = tf.keras.layers.Dense(len(class_names), activation="softmax")(x)
        model = tf.keras.Model(inputs, outputs)
        model.compile(
            optimizer=tf.keras.optimizers.Adam(),
            loss="sparse_categorical_crossentropy",
            metrics=["accuracy"],
        )
    except Exception as exc:
        print(f"Error: could not create the model: {exc}")
        return 1

    print(f"Training for {args.epochs} epochs...")
    try:
        model.fit(train_ds, epochs=args.epochs)
    except Exception as exc:
        print(f"Error: training failed: {exc}")
        return 1

    saved_model_path = output_path / "saved_model"
    tfjs_path = output_path / "tfjs_model"
    class_names_path = output_path / "class_names.json"

    try:
        output_path.mkdir(parents=True, exist_ok=True)
        remove_path(saved_model_path)
        remove_path(tfjs_path)
    except OSError as exc:
        print(f"Error: cannot prepare output directory '{output_path}': {exc}")
        return 1

    try:
        with class_names_path.open("w", encoding="utf-8") as handle:
            json.dump(class_names, handle, indent=2)
            handle.write("\n")
    except OSError as exc:
        print(f"Error: cannot write class names file '{class_names_path}': {exc}")
        return 1

    @tf.function(
        input_signature=[
            tf.TensorSpec(
                shape=[None, args.image_size, args.image_size, 3],
                dtype=tf.float32,
                name="images",
            )
        ]
    )
    def serving_fn(images):
        return {"predictions": model(images, training=False)}

    try:
        if hasattr(model, "export"):
            model.export(str(saved_model_path))
        else:
            tf.saved_model.save(
                model,
                str(saved_model_path),
                signatures={"serving_default": serving_fn},
            )
    except Exception as exc:
        print(f"Error: could not save TensorFlow SavedModel to '{saved_model_path}': {exc}")
        return 1

    command = [
        "tensorflowjs_converter",
        "--input_format", "tf_saved_model",
        "--output_format", "tfjs_graph_model",
        "--signature_name", "serving_default",
        "--quantization_bytes=2",
        str(saved_model_path),
        str(tfjs_path),
    ]

    print("Converting SavedModel to TensorFlow.js graph model...")
    try:
        subprocess.run(command, check=True)
    except FileNotFoundError:
        print("Error: tensorflowjs_converter was not found. Install it with 'python -m pip install tensorflowjs' and rerun.")
        return 1
    except subprocess.CalledProcessError as exc:
        print(f"Error: tensorflowjs_converter failed with exit code {exc.returncode}.")
        return 1

    print("Training and conversion completed successfully.")
    print(f"Classes: {len(class_names)}")
    print(f"SavedModel: {saved_model_path}")
    print(f"TensorFlow.js model: {tfjs_path}")
    print(f"Class names: {class_names_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
