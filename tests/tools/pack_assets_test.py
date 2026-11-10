#!/usr/bin/env python3
"""tools/pack-assets.py, run for real on a small throwaway site tree.

    python3 tests/tools/pack_assets_test.py
"""
import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent.parent / "tools" / "pack-assets.py"

spec = importlib.util.spec_from_file_location("pack_assets", SCRIPT)
pack_assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack_assets)


def configs(device, default, files):
    """A <device>.configs.json whose configurations are {name: {view: file}}."""
    return {"device": device, "default": default,
            "configs": [{"name": n, "files": f} for n, f in files.items()]}


def tree(root):
    """Every file under root as {relative path: bytes}."""
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(Path(root).rglob("*")) if p.is_file()}


class PackAssetsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.dist = self.root / "assets" / "dist"
        self.exports = self.root / "assets" / "exports"
        self.dist.mkdir(parents=True)
        self.exports.mkdir(parents=True)

    def face(self, name, text):
        (self.dist / name).write_text(text)

    def device(self, name, default, files, plain=()):
        """The default configuration's faces under their real names, and the plain copies named."""
        (self.dist / f"{name}.configs.json").write_text(json.dumps(configs(name, default, {default: files})))
        for view, file in files.items():
            self.face(file, f"{name} {view}")
        for view in plain:
            self.face(f"{name}.{view}.svg", f"{name} {view}")

    def yaml(self, rel, text):
        path = self.exports / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def listing(self, files):
        (self.exports / "files.json").write_text(json.dumps(files))

    def run_pack(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pack_assets.main([str(self.root)])
        return out.getvalue()

    def test_drops_a_plain_face_equal_to_the_default_face(self):
        self.device("alpha", "ac", {"front": "alpha.ac.front.svg", "rear": "alpha.ac.rear.svg"},
                    plain=("front", "rear"))
        self.listing({})
        self.run_pack()
        self.assertFalse((self.dist / "alpha.front.svg").exists())
        self.assertFalse((self.dist / "alpha.rear.svg").exists())
        self.assertTrue((self.dist / "alpha.ac.front.svg").exists())
        self.assertEqual(json.loads((self.dist / "default-faces.json").read_text()),
                         {"alpha": {"front": "alpha.ac.front.svg", "rear": "alpha.ac.rear.svg"}})

    def test_keeps_the_plain_faces_of_the_named_devices(self):
        for name in pack_assets.KEEP_PLAIN:
            self.device(name, "ac", {"front": f"{name}.ac.front.svg"}, plain=("front",))
        self.listing({})
        self.run_pack()
        for name in pack_assets.KEEP_PLAIN:
            self.assertTrue((self.dist / f"{name}.front.svg").exists(), name)

    def test_keeps_and_says_a_plain_face_that_differs_or_has_no_default(self):
        self.device("beta", "ac", {"front": "beta.ac.front.svg"}, plain=("front",))
        self.face("beta.front.svg", "something else")                      # differs
        self.face("beta.rear.svg", "a rear nobody names")                  # no default face for it
        self.listing({})
        said = self.run_pack()
        self.assertEqual((self.dist / "beta.front.svg").read_text(), "something else")
        self.assertTrue((self.dist / "beta.rear.svg").exists())
        self.assertIn("kept beta.front.svg", said)
        self.assertIn("kept beta.rear.svg", said)

    def test_a_default_face_that_is_the_plain_name_is_not_deleted(self):
        self.device("gamma", "ac", {"front": "gamma.front.svg"})
        self.listing({})
        self.run_pack()
        self.assertTrue((self.dist / "gamma.front.svg").exists())

    def test_sizes_list_only_what_is_left(self):
        self.device("alpha", "ac", {"front": "alpha.ac.front.svg"}, plain=("front",))
        self.listing({})
        self.run_pack()
        sizes = json.loads((self.dist / "sizes.json").read_text())
        self.assertEqual(sorted(sizes), ["alpha.ac.front.svg"])

    def test_packs_the_exports_and_then_removes_the_loose_files(self):
        rels = ["netbox/device-types/Acme Co/a.yaml", "netbox/module-types/Acme Co/m.yaml",
                "nautobot/device-types/Acme Co/a.yaml", "fibre-maps/FS.com/c d.yaml"]
        for rel in rels:
            self.yaml(rel, f"# {rel}\nline: é\r\n")
        self.listing({"netbox": rels[:2], "nautobot": [rels[2]], "fibre-maps": [rels[3]]})
        self.run_pack()
        pack = json.loads((self.exports / "packs" / "netbox" / "Acme Co.json").read_text(encoding="utf-8"))
        self.assertEqual(pack, {rels[0]: f"# {rels[0]}\nline: é\r\n", rels[1]: f"# {rels[1]}\nline: é\r\n"})
        self.assertTrue((self.exports / "packs" / "nautobot" / "Acme Co.json").exists())
        self.assertTrue((self.exports / "packs" / "fibre-maps" / "FS.com.json").exists())
        self.assertEqual(list(self.exports.rglob("*.yaml")), [])

    def test_a_listed_path_with_no_file_and_no_pack_entry_stops_before_anything_is_deleted(self):
        self.yaml("netbox/device-types/Acme/a.yaml", "a: 1\n")
        self.listing({"netbox": ["netbox/device-types/Acme/a.yaml", "netbox/device-types/Acme/gone.yaml"]})
        before = tree(self.exports)
        with self.assertRaises(SystemExit):
            self.run_pack()
        self.assertEqual(tree(self.exports), before)

    def test_a_pack_that_does_not_match_its_loose_file_stops_before_anything_is_deleted(self):
        self.yaml("netbox/device-types/Acme/a.yaml", "a: 1\n")
        self.listing({"netbox": ["netbox/device-types/Acme/a.yaml"]})
        real = pack_assets.json.dumps
        # a writer that corrupts the text, as a bad encoding step would
        pack_assets.json.dumps = lambda obj, **kw: real({k: v.upper() for k, v in obj.items()}, **kw) \
            if kw.get("sort_keys") and all(isinstance(v, str) for v in obj.values()) else real(obj, **kw)
        self.addCleanup(setattr, pack_assets.json, "dumps", real)
        before = tree(self.exports)
        with self.assertRaises(SystemExit):
            self.run_pack()
        self.assertEqual(tree(self.exports), before)
        self.assertEqual(list(self.exports.glob("packs-*")), [], "the temporary folder is gone")

    def test_an_interrupted_run_is_finished_by_the_next(self):
        rel = "netbox/device-types/Acme/a.yaml"
        self.yaml(rel, "a: 1\n")
        self.yaml("netbox/device-types/Acme/b.yaml", "b: 1\n")
        self.listing({"netbox": [rel, "netbox/device-types/Acme/b.yaml"]})
        self.run_pack()
        # a run that stopped after moving the packs in but before deleting b's loose file
        self.yaml("netbox/device-types/Acme/b.yaml", "b: 1\n")
        self.run_pack()
        pack = json.loads((self.exports / "packs" / "netbox" / "Acme.json").read_text())
        self.assertEqual(pack, {rel: "a: 1\n", "netbox/device-types/Acme/b.yaml": "b: 1\n"})
        self.assertEqual(list(self.exports.rglob("*.yaml")), [])

    def test_a_second_run_changes_nothing(self):
        self.device("alpha", "ac", {"front": "alpha.ac.front.svg"}, plain=("front",))
        self.yaml("netbox/device-types/Acme/a.yaml", "a: 1\n")
        self.listing({"netbox": ["netbox/device-types/Acme/a.yaml"]})
        self.run_pack()
        first = tree(self.root)
        self.run_pack()
        self.assertEqual(tree(self.root), first)


if __name__ == "__main__":
    unittest.main()
