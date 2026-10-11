"""Record the public surface of a contracts folder as a JSON baseline.

    python tests/tools/make_abi_snapshot.py <folder-with-govlayercore.py> > tests/abi_baseline.json

Re-run ONLY when you deliberately change the frontend-facing surface (and then
update the frontend in the same change)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))                        # tests/
import helpers as h                                              # noqa: E402
from abi_surface import collect                                  # noqa: E402

folder = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else h.ROOT
core = h.load_module(os.path.relpath(os.path.join(folder, "govlayercore.py"), h.ROOT), "snap_core")
admin = h.load_module(os.path.relpath(os.path.join(folder, "govlayeradmin.py"), h.ROOT), "snap_admin")
print(json.dumps(collect(core, admin), indent=2, sort_keys=True))
