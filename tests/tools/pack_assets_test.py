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


def tree(root):
    """Every file under root as {relative path: bytes}."""
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(Path(root).rglob("*")) if p.is_file()}


SKINS = ["components/acme--card--v1--default.svg", "components/acme--card--v2--default.svg"]


class PackAssetsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.built = self.root / "built"
        self.dist = self.root / "assets" / "dist"
        self.exports = self.root / "assets" / "exports"
        self.has_library = False
        self.built.mkdir()
        self.dist.mkdir(parents=True)
        self.exports.mkdir(parents=True)

    def write(self, base, rel, text):
        path = base / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def library(self):
        """A built dist of two devices (alpha has a second configuration, so a second
        pack; beta one), one skin namespace, the plain files and every single the
        build also holds; and the site's dist as the refresh leaves it before this
        script runs: configs.json files and the packs Portrayal's tool wrote."""
        alpha = {"ac": {"front": "alpha.ac.front.svg", "rear": "alpha.ac.rear.svg"},
                 "dc": {"front": "alpha.dc.front.svg", "rear": "alpha.ac.rear.svg"}}
        beta = {"std": {"front": "beta.std.front.svg"}}
        self.has_library = True
        faces = {}
        for name, default, files in (("alpha", "ac", alpha), ("beta", "std", beta)):
            cfg = json.dumps({"device": name, "default": default,
                              "configs": [{"name": n, "files": f} for n, f in files.items()]})
            for base in (self.built, self.dist):
                self.write(base, f"{name}.configs.json", cfg)
            for f in files.values():
                for file in f.values():
                    faces[file] = f"<svg>{name} {file} é</svg>"
        for rel, text in faces.items():
            self.write(self.built, rel, text)
        self.write(self.built, "alpha.front.svg", faces["alpha.ac.front.svg"])        # a single
        for rel in pack_assets.PLAIN_FILES + SKINS:
            self.write(self.built, rel, f"<svg>{rel}</svg>")
        packs = self.dist / "packs"
        self.write(packs, "devices/alpha.json", json.dumps({"more": True, "files": {
            k: faces[k] for k in ("alpha.ac.front.svg", "alpha.ac.rear.svg")}}))
        self.write(packs, "devices/alpha.more.json", json.dumps({"files": {
            "alpha.dc.front.svg": faces["alpha.dc.front.svg"]}}))
        self.write(packs, "devices/beta.json", json.dumps({"more": False, "files": {
            "beta.std.front.svg": faces["beta.std.front.svg"]}}))
        self.write(packs, "components/index.json", json.dumps({"acme": [SKINS[1][len("components/"):]]}))
        for k, skin in enumerate(SKINS, 1):
            self.write(packs, f"components/acme.{k}.json", json.dumps({"files": {skin: f"<svg>{skin}</svg>"}}))
        return faces

    def yaml(self, rel, text):
        path = self.exports / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def listing(self, files):
        (self.exports / "files.json").write_text(json.dumps(files))

    def run_pack(self):
        """As the refresh runs it when a library was made (the built dist named), else on the tree as it stands."""
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pack_assets.main([str(self.root)] + ([str(self.built)] if self.has_library else []))
        return out.getvalue()

    def loose_drawings(self):
        return sorted(p.relative_to(self.dist).as_posix() for p in self.dist.rglob("*.svg"))

    def test_copies_only_the_plain_files(self):
        self.library()
        self.listing({})
        self.run_pack()
        self.assertEqual(self.loose_drawings(), sorted(pack_assets.PLAIN_FILES))
        for rel in pack_assets.PLAIN_FILES:
            self.assertEqual((self.dist / rel).read_bytes(), (self.built / rel).read_bytes(), rel)
        self.assertEqual(len([r for r in pack_assets.PLAIN_FILES if "/" not in r]), 12)
        self.assertEqual(len(pack_assets.PLAIN_SKINS), 2)

    def test_the_singles_are_not_copied(self):
        self.library()
        self.listing({})
        self.run_pack()
        for rel in ["alpha.front.svg", "alpha.ac.front.svg", "alpha.dc.front.svg", "beta.std.front.svg"] + SKINS:
            self.assertFalse((self.dist / rel).exists(), rel)
        # what stays plain files is untouched: configs, and the packs themselves
        for rel in ["alpha.configs.json", "beta.configs.json", "packs/devices/alpha.more.json",
                    "packs/components/index.json"]:
            self.assertTrue((self.dist / rel).is_file(), rel)

    def test_default_faces_come_from_each_default_configuration(self):
        self.library()
        self.listing({})
        self.run_pack()
        self.assertEqual(json.loads((self.dist / "default-faces.json").read_text()),
                         {"alpha": {"front": "alpha.ac.front.svg", "rear": "alpha.ac.rear.svg"},
                          "beta": {"front": "beta.std.front.svg"}})

    def test_sizes_are_computed_from_the_pack_entries_and_the_plain_files(self):
        faces = self.library()
        self.listing({})
        self.run_pack()
        sizes = json.loads((self.dist / "sizes.json").read_text())
        want = {k: len(v.encode("utf-8")) for k, v in faces.items()}       # the packed faces, in bytes not characters
        want.update({s: len(f"<svg>{s}</svg>".encode()) for s in SKINS})
        want.update({r: len(f"<svg>{r}</svg>".encode()) for r in pack_assets.PLAIN_FILES})
        self.assertEqual(sizes, want)
        self.assertEqual(list(sizes), sorted(sizes), "keyed in order")
        self.assertNotIn("packs/devices/alpha.json", sizes)
        self.assertNotIn("packs/components/index.json", sizes)

    def test_a_build_without_a_plain_file_stops_the_run(self):
        self.library()
        self.listing({})
        (self.built / pack_assets.PLAIN_FILES[0]).unlink()
        with self.assertRaises(SystemExit):
            self.run_pack()

    def test_a_drawing_left_outside_the_packs_stops_the_run(self):
        faces = self.library()
        self.listing({})
        self.write(self.dist, "alpha.ac.front.svg", faces["alpha.ac.front.svg"])
        with self.assertRaises(SystemExit):
            self.run_pack()

    def test_no_packs_stops_the_run(self):
        self.library()
        self.listing({})
        (self.dist / "packs" / "components" / "index.json").unlink()
        with self.assertRaises(SystemExit):
            self.run_pack()

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
        self.library()
        self.yaml("netbox/device-types/Acme/a.yaml", "a: 1\n")
        self.listing({"netbox": ["netbox/device-types/Acme/a.yaml"]})
        self.run_pack()
        first = tree(self.root)
        self.run_pack()
        self.assertEqual(tree(self.root), first)


if __name__ == "__main__":
    unittest.main()
