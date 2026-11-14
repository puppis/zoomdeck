"""Prepare the JupyterLite build: pack docs/site/zoomdeck_nb.py as a wheel, and write the
lab's configuration so that its Python kernel loads the wheel when it starts (a notebook then
just imports the helper, as it does in a local Jupyter where the file sits next to it).

    python docs/lite/build-wheel.py

The wheel is fetched by the kernel from the published site, whose address is
https://puppis.github.io/zoomdeck/ unless the ZOOMDECK_SITE environment variable says otherwise
(a local server while testing). A wheel is a zip with the module and a dist-info folder;
nothing but the standard library is needed to write one, so the documentation build has no
Python packaging dependency.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LITE = ROOT / "docs" / "lite"
MODULE = ROOT / "docs" / "site" / "zoomdeck_nb.py"
NAME = "zoomdeck_nb"
VERSION = "0.1.0"
SITE = os.environ.get("ZOOMDECK_SITE", "https://puppis.github.io/zoomdeck/").rstrip("/") + "/"


def record_line(name: str, data: bytes) -> str:
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
    return f"{name},sha256={digest},{len(data)}"


def main() -> None:
    out = LITE / "wheels"
    out.mkdir(parents=True, exist_ok=True)
    wheel = out / f"{NAME}-{VERSION}-py3-none-any.whl"
    source = MODULE.read_bytes()
    summary = re.match(r'"""(.*?)\n', MODULE.read_text(encoding="utf8")).group(1)
    info = f"{NAME}-{VERSION}.dist-info"
    files = {
        f"{NAME}.py": source,
        f"{info}/METADATA": f"Metadata-Version: 2.1\nName: {NAME}\nVersion: {VERSION}\nSummary: {summary}\nLicense: MIT\n".encode(),
        f"{info}/WHEEL": b"Wheel-Version: 1.0\nGenerator: zoomdeck\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
        f"{info}/top_level.txt": f"{NAME}\n".encode(),
    }
    record = "\n".join(record_line(name, data) for name, data in files.items()) + f"\n{info}/RECORD,,\n"
    with zipfile.ZipFile(wheel, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)), data)
        archive.writestr(zipfile.ZipInfo(f"{info}/RECORD", (2026, 1, 1, 0, 0, 0)), record)
    config = {
        "jupyter-lite-schema-version": 0,
        "jupyter-config-data": {
            "appName": "Zoomdeck notebooks",
            "litePluginSettings": {
                "@jupyterlite/pyodide-kernel-extension:kernel": {
                    "loadPyodideOptions": {"packages": [f"{SITE}lite/files/{wheel.name}"]},
                },
            },
        },
    }
    (LITE / "jupyter-lite.json").write_text(json.dumps(config, indent=2) + "\n")
    print(f"{wheel}\nkernel loads it from {SITE}lite/files/{wheel.name}")


if __name__ == "__main__":
    main()
