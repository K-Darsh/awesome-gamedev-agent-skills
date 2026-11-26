#!/usr/bin/env python3
"""Check an open-world city content manifest against Play delivery and mobile frame budgets.

Reads a JSON manifest (modules with sizes, a perf block, a content block) and checks it against the
limits that decide whether the game can ship:

  Play delivery
    base module            <= 200 MB        (the code + first district)
    feature module         <= 200 MB
    single asset pack      <= 1536 MB       (1.5 GB)
    install-time packs     <= 4096 MB
    fast-follow + on-demand<= 4096 MB       (30720 MB only with "level_up": true)
    pack count             <= 100
    base + all packs       <= 8192 MB       (32768 MB only with "level_up": true)
    artifact               =  "aab"         (APKs above 100 MB do not install through Play)

  Mobile frame budget (mid tier, 30-60 fps)
    draw calls             <= 220 hard, 120 target
    triangles              <= 600k hard, 300k target
    texture memory         <= 400 MB hard, 220 MB target
    allocations in update  <= 2 KB/frame hard, 0 target

Every size is the compressed download size Play reports, not the folder size. The tool is a
paper gate: it cannot prove a frame time, it only refuses to let an impossible manifest through.
Measure p95 frame time on device after it passes.

Exit codes: 0 = no errors (and no warnings with --strict), 1 = errors, or warnings with --strict,
2 = missing or invalid manifest. Standard library only; no network.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

TOOL = "ship_budgets"
SCHEMA = 1

BASE_MB = 200
FEATURE_MB = 200
PACK_MB = 1536
INSTALL_PACKS_MB = 4096
DOWNLOAD_PACKS_MB = 4096
DOWNLOAD_PACKS_MB_LEVEL_UP = 30720
TOTAL_MB = 8192
TOTAL_MB_LEVEL_UP = 32768
MAX_PACKS = 100

PERF_HARD = {"draw_calls": 220, "triangles": 600_000, "texture_mb": 400, "gc_bytes_frame": 2048}
PERF_TARGET = {"draw_calls": 120, "triangles": 300_000, "texture_mb": 220, "gc_bytes_frame": 0}
PERF_RATIO = {"draw_calls": 1.0, "triangles": 0.5, "texture_mb": 0.55, "gc_bytes_frame": 0.0}

FIRST_SESSION_WARN_MB = 3000
CONTENT_MINIMUM = {"districts": 2, "vehicles": 6, "missions": 5, "properties": 3}

EXAMPLE = """{
  "schema": 1,
  "game": "neon-coast",
  "artifact": "aab",
  "level_up": false,
  "target_fps": 60,
  "min_device_ram_gb": 4,
  "modules": [
    {"id": "base", "kind": "base", "size_mb": 118},
    {"id": "pack_city_02", "kind": "fast-follow", "size_mb": 900},
    {"id": "pack_vehicles", "kind": "fast-follow", "size_mb": 420},
    {"id": "pack_airport", "kind": "on-demand", "size_mb": 480}
  ],
  "perf": {"draw_calls": 118, "triangles": 290000, "texture_mb": 210, "gc_bytes_frame": 0},
  "content": {"districts": 3, "vehicles": 12, "missions": 8, "properties": 6,
              "texture_format": "astc", "audio_kbps": 128}
}
Kinds: base (exactly one), feature, install-time, fast-follow, on-demand. Sizes are compressed MB, from the
Play Console size report. Omit "level_up" unless the account is enrolled in that program."""


class SpecError(ValueError):
    pass


def number(obj: dict, key: str, default=None, minimum: float = 0.0):
    value = obj.get(key, default)
    if value is None:
        raise SpecError(f"missing '{key}'")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < minimum:
        raise SpecError(f"'{key}' must be a number >= {minimum}")
    return float(value)


def integer(obj: dict, key: str, default=None, minimum: int = 0):
    value = number(obj, key, default, minimum)
    if value != int(value):
        raise SpecError(f"'{key}' must be a whole number")
    return int(value)


def analyse(spec: dict) -> dict:
    if not isinstance(spec, dict):
        raise SpecError("manifest must be a JSON object")
    if integer(spec, "schema", SCHEMA) != SCHEMA:
        raise SpecError(f"unsupported schema (expected {SCHEMA})")

    artifact = spec.get("artifact", "aab")
    level_up = bool(spec.get("level_up", False))
    target_fps = integer(spec, "target_fps", 60, 1)
    ram_gb = number(spec, "min_device_ram_gb", 4, 1)

    modules = spec.get("modules")
    if not isinstance(modules, list) or not modules:
        raise SpecError("'modules' must be a non-empty list")
    kinds = {"base", "feature", "install-time", "fast-follow", "on-demand"}
    sized = []
    for index, module in enumerate(modules):
        if not isinstance(module, dict):
            raise SpecError(f"modules[{index}] must be an object")
        kind = module.get("kind")
        if kind not in kinds:
            raise SpecError(f"modules[{index}] has unknown kind {kind!r} (use {sorted(kinds)})")
        sized.append({
            "id": str(module.get("id") or f"{kind}_{index}"),
            "kind": kind,
            "size_mb": number(module, "size_mb"),
        })

    perf = spec.get("perf", {})
    if not isinstance(perf, dict):
        raise SpecError("'perf' must be an object")
    content = spec.get("content", {})
    if not isinstance(content, dict):
        raise SpecError("'content' must be an object")

    errors, warnings = [], []
    base = [m for m in sized if m["kind"] == "base"]
    features = [m for m in sized if m["kind"] == "feature"]
    packs = [m for m in sized if m["kind"] in ("install-time", "fast-follow", "on-demand")]
    installed = [m for m in packs if m["kind"] == "install-time"]
    downloaded = [m for m in packs if m["kind"] in ("fast-follow", "on-demand")]

    if len(base) != 1:
        errors.append(f"needs exactly one 'base' module, found {len(base)}")
    for module in base:
        if module["size_mb"] > BASE_MB:
            errors.append(f"base {module['id']} is {module['size_mb']:.0f} MB, over the {BASE_MB} MB "
                          "module limit; move the first district into an install-time pack")
    for module in features:
        if module["size_mb"] > FEATURE_MB:
            errors.append(f"feature module {module['id']} is {module['size_mb']:.0f} MB, over "
                          f"{FEATURE_MB} MB")
    for module in packs:
        if module["size_mb"] > PACK_MB:
            errors.append(f"asset pack {module['id']} is {module['size_mb']:.0f} MB, over the "
                          f"{PACK_MB} MB pack limit; split it by district")
    if len(packs) > MAX_PACKS:
        errors.append(f"{len(packs)} asset packs, over the {MAX_PACKS} pack limit")
    if artifact != "aab":
        errors.append(f"artifact is {artifact!r}; Play installs App Bundles, and an APK above "
                      "100 MB cannot be installed at all")

    install_mb = sum(m["size_mb"] for m in installed)
    download_mb = sum(m["size_mb"] for m in downloaded)
    base_mb = sum(m["size_mb"] for m in base)
    total_mb = base_mb + sum(m["size_mb"] for m in features) + install_mb + download_mb
    download_cap = DOWNLOAD_PACKS_MB_LEVEL_UP if level_up else DOWNLOAD_PACKS_MB
    total_cap = TOTAL_MB_LEVEL_UP if level_up else TOTAL_MB

    if install_mb > INSTALL_PACKS_MB:
        errors.append(f"install-time packs total {install_mb:.0f} MB, over {INSTALL_PACKS_MB} MB")
    if download_mb > download_cap:
        errors.append(f"fast-follow + on-demand total {download_mb:.0f} MB, over {download_cap} MB "
                      + ("with Level Up" if level_up else "without Level Up enrollment"))
    if total_mb > total_cap:
        errors.append(f"total content {total_mb:.0f} MB, over the {total_cap} MB ceiling")
    if not level_up and total_mb > 7000:
        warnings.append(f"total content {total_mb:.0f} MB leaves little room for the 8 GB ceiling; "
                        "cut audio bitrate or hero textures before adding more districts")

    first_session = base_mb + install_mb + sum(
        m["size_mb"] for m in downloaded if m["kind"] == "fast-follow")
    if first_session > FIRST_SESSION_WARN_MB:
        warnings.append(f"first session pulls {first_session:.0f} MB; move a district to on-demand "
                        "or the player waits before driving")

    for key, hard in PERF_HARD.items():
        if key not in perf:
            warnings.append(f"perf.{key} missing; the budget gate cannot check it")
            continue
        value = number(perf, key)
        if value > hard:
            errors.append(f"perf.{key} is {value:.0f}, over the hard budget {hard}")
        elif value > PERF_TARGET[key]:
            warnings.append(f"perf.{key} is {value:.0f}, over the target {PERF_TARGET[key]}")

    if target_fps >= 90 and ram_gb < 6:
        warnings.append(f"{target_fps} fps on {ram_gb:.0f} GB devices is a thermal promise, not a "
                        "frame budget; offer a 60 fps tier and adaptive resolution")

    texture_format = str(content.get("texture_format", "")).lower()
    if texture_format not in ("astc", "etc2"):
        warnings.append("texture_format is not ASTC/ETC2; uncompressed textures blow both memory "
                        "and download size")
    audio_kbps = content.get("audio_kbps", 0)
    if isinstance(audio_kbps, (int, float)) and audio_kbps > 160:
        warnings.append(f"audio at {audio_kbps:.0f} kbps; 96-128 kbps is transparent for radio on "
                        "a phone and saves gigabytes")
    for key, minimum in CONTENT_MINIMUM.items():
        value = content.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise SpecError(f"content.{key} must be a number")
        if value < minimum:
            warnings.append(f"content.{key} is {value:.0f}; a city slice reads thin below {minimum}")

    return {
        "tool": TOOL,
        "schema": SCHEMA,
        "game": spec.get("game"),
        "level_up": level_up,
        "artifact": artifact,
        "totals": {
            "base_mb": base_mb,
            "install_time_mb": install_mb,
            "downloaded_mb": download_mb,
            "total_mb": total_mb,
            "first_session_mb": first_session,
            "packs": len(packs),
            "download_cap_mb": download_cap,
            "total_cap_mb": total_cap,
        },
        "modules": sized,
        "error_count": len(errors),
        "warning_count": len(warnings),
        "errors": errors,
        "warnings": warnings,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="check_ship_budgets.py", description=__doc__.split("\n\n")[0],
        epilog="Manifest example:\n" + EXAMPLE,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("manifest", type=Path, help="JSON content manifest")
    parser.add_argument("--json", action="store_true", help="print one JSON object")
    parser.add_argument("--strict", action="store_true", help="exit 1 on warnings too")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    if not args.manifest.is_file():
        print(f"error: manifest not found: {args.manifest}", file=sys.stderr)
        return 2
    try:
        spec = json.loads(args.manifest.read_text(encoding="utf-8"))
        result = analyse(spec)
    except (json.JSONDecodeError, SpecError) as error:
        print(f"error: invalid manifest: {error}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        totals = result["totals"]
        print(f"{'module':<18}{'kind':<14}{'MB':>7}")
        for module in result["modules"]:
            print(f"{module['id']:<18}{module['kind']:<14}{module['size_mb']:>7.0f}")
        print(f"\nbase {totals['base_mb']:.0f} MB · install-time {totals['install_time_mb']:.0f} MB · "
              f"downloaded {totals['downloaded_mb']:.0f} MB of {totals['download_cap_mb']} MB · "
              f"total {totals['total_mb']:.0f} MB of {totals['total_cap_mb']} MB")
        if result["level_up"]:
            print("Level Up enrollment assumed; the 8 GB standard ceiling does not apply.")
        for error in result["errors"]:
            print(f"ERROR: {error}")
        for warning in result["warnings"]:
            print(f"WARNING: {warning}")
        print(f"Summary: {result['error_count']} error(s), {result['warning_count']} warning(s)")
    if result["errors"] or (args.strict and result["warnings"]):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
