"""Tests for the open-world city budget checker (skills/genres/open-world-city-game)."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECK = ROOT / "skills/genres/open-world-city-game/scripts/check_ship_budgets.py"
EXAMPLE = ROOT / "skills/genres/open-world-city-game/assets/ship-budget.json"


def run(manifest, *args):
    path = Path(manifest)
    return subprocess.run([sys.executable, str(CHECK), str(path), *args],
                          capture_output=True, text=True, timeout=60)


def write(spec):
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    json.dump(spec, handle)
    handle.close()
    return handle.name


def base_spec(**overrides):
    spec = {
        "schema": 1,
        "game": "test-city",
        "artifact": "aab",
        "level_up": False,
        "target_fps": 60,
        "min_device_ram_gb": 6,
        "modules": [
            {"id": "base", "kind": "base", "size_mb": 120},
            {"id": "pack_city_02", "kind": "fast-follow", "size_mb": 600},
            {"id": "pack_audio", "kind": "on-demand", "size_mb": 300},
        ],
        "perf": {"draw_calls": 110, "triangles": 280_000, "texture_mb": 200, "gc_bytes_frame": 0},
        "content": {"districts": 3, "vehicles": 10, "missions": 8, "properties": 5,
                    "texture_format": "astc", "audio_kbps": 128},
    }
    spec.update(overrides)
    return spec


class ShipBudgetTests(unittest.TestCase):
    def test_shipped_example_passes_clean(self):
        result = run(EXAMPLE, "--json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["tool"], "ship_budgets")
        self.assertEqual(data["error_count"], 0)
        self.assertEqual(data["warning_count"], 0)
        self.assertEqual(data["totals"]["packs"], 5)
        self.assertLess(data["totals"]["total_mb"], 8192)

    def test_base_module_over_200_mb_fails(self):
        result = run(write(base_spec(modules=[{"id": "base", "kind": "base", "size_mb": 260}])))
        self.assertEqual(result.returncode, 1)
        self.assertIn("over the 200 MB module limit", result.stdout)

    def test_asset_pack_over_1_5_gb_fails(self):
        spec = base_spec(modules=[{"id": "base", "kind": "base", "size_mb": 120},
                                  {"id": "pack_huge", "kind": "fast-follow", "size_mb": 1700}])
        result = run(write(spec))
        self.assertEqual(result.returncode, 1)
        self.assertIn("1536 MB pack limit", result.stdout)

    def test_total_over_8_gb_fails_but_level_up_can_carry_9_gb(self):
        modules = [{"id": "base", "kind": "base", "size_mb": 150},
                   {"id": "pack_1", "kind": "fast-follow", "size_mb": 1500},
                   {"id": "pack_2", "kind": "fast-follow", "size_mb": 1500},
                   {"id": "pack_3", "kind": "fast-follow", "size_mb": 1500},
                   {"id": "pack_4", "kind": "fast-follow", "size_mb": 1500},
                   {"id": "pack_5", "kind": "fast-follow", "size_mb": 1500}]
        standard = run(write(base_spec(modules=modules)))
        self.assertEqual(standard.returncode, 1)
        self.assertIn("without Level Up enrollment", standard.stdout)
        enrolled = run(write(base_spec(modules=modules, level_up=True)))
        self.assertEqual(enrolled.returncode, 0, enrolled.stdout)
        self.assertIn("Level Up enrollment assumed", enrolled.stdout)

    def test_apk_artifact_is_rejected(self):
        result = run(write(base_spec(artifact="apk")))
        self.assertEqual(result.returncode, 1)
        self.assertIn("App Bundles", result.stdout)

    def test_draw_call_and_texture_hard_budgets(self):
        spec = base_spec(perf={"draw_calls": 260, "triangles": 700_000, "texture_mb": 480,
                               "gc_bytes_frame": 4096})
        result = run(write(spec))
        self.assertEqual(result.returncode, 1)
        self.assertIn("over the hard budget 220", result.stdout)
        self.assertIn("over the hard budget 600000", result.stdout)

    def test_soft_budgets_warn_and_strict_turns_them_into_a_failure(self):
        spec = base_spec(perf={"draw_calls": 160, "triangles": 280_000, "texture_mb": 200,
                               "gc_bytes_frame": 0})
        lenient = run(write(spec))
        self.assertEqual(lenient.returncode, 0)
        self.assertIn("WARNING: perf.draw_calls", lenient.stdout)
        strict = run(write(spec), "--strict")
        self.assertEqual(strict.returncode, 1)

    def test_missing_perf_key_warns_instead_of_crashing(self):
        spec = base_spec(perf={"draw_calls": 100, "triangles": 200_000, "texture_mb": 150})
        result = run(write(spec))
        self.assertEqual(result.returncode, 0)
        self.assertIn("perf.gc_bytes_frame missing", result.stdout)

    def test_ninety_fps_on_small_ram_warns(self):
        result = run(write(base_spec(target_fps=120, min_device_ram_gb=4)))
        self.assertEqual(result.returncode, 0)
        self.assertIn("thermal promise", result.stdout)

    def test_texture_format_and_audio_bitrate_warnings(self):
        spec = base_spec(content={"districts": 1, "vehicles": 4, "missions": 3, "properties": 1,
                                  "texture_format": "png", "audio_kbps": 256})
        result = run(write(spec))
        self.assertEqual(result.returncode, 0)
        for needle in ("ASTC/ETC2", "96-128 kbps", "content.districts is 1", "content.vehicles is 4"):
            self.assertIn(needle, result.stdout)

    def test_two_base_modules_is_an_error(self):
        spec = base_spec(modules=[{"id": "base", "kind": "base", "size_mb": 100},
                                  {"id": "base_2", "kind": "base", "size_mb": 100}])
        result = run(write(spec))
        self.assertEqual(result.returncode, 1)
        self.assertIn("exactly one 'base' module", result.stdout)

    def test_unknown_kind_and_missing_file_are_spec_errors(self):
        bad = run(write(base_spec(modules=[{"id": "base", "kind": "patch", "size_mb": 10}])))
        self.assertEqual(bad.returncode, 2)
        self.assertIn("unknown kind", bad.stderr)
        missing = run(ROOT / "does-not-exist.json")
        self.assertEqual(missing.returncode, 2)


if __name__ == "__main__":
    unittest.main()
