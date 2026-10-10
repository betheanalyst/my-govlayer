"""Shared test support for the GovLayer contract suite.

Everything here runs on the in-process `genlayer` stub in tests/support, so the
suite needs only the Python standard library. Run from the contracts/ folder:

    python -m unittest discover -s tests -v
"""
import importlib.util
import json
import os
import re
import sys
import unittest
from contextlib import contextmanager

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # contracts/
sys.path.insert(0, os.path.join(HERE, "support"))  # provides the `genlayer` stub

import genlayer as G                               # noqa: E402  (stub)
from genlayer import gl, Address                   # noqa: E402


def load_module(relpath, name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, relpath))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


CORE = load_module("govlayercore.py", "govlayercore_under_test")
ADMIN = load_module("govlayeradmin.py", "govlayeradmin_under_test")

# ---------------------------------------------------------------- constants
T0 = 1_800_000_000          # arbitrary fixed "now" (after MIN_VALID_TIMESTAMP)
HOUR = 3600
DAY = 86400
TIMELOCK = ADMIN.TIMELOCK_SECONDS
APPROVAL_WINDOW = ADMIN.APPROVAL_WINDOW_SECONDS
VALIDITY = CORE.ACTION_VALIDITY_WINDOW_SECONDS

ACCEPT = '{"decision":"accept","reasoning":"ok","constitutional_conflicts":[]}'
REVISE = ('{"decision":"revise","reasoning":"tweak",'
          '"constitutional_conflicts":[{"description":"x","severity":"low"}]}')
REJECT = '{"decision":"reject","reasoning":"no","constitutional_conflicts":[]}'
DISPUTE_ACCEPT = '{"decision":"accept","reasoning":"on reflection fine"}'
DISPUTE_REJECT = '{"decision":"reject","reasoning":"still no"}'

GENESIS = "We govern fairly. Rule 1: no harm."


def A(i):
    """Deterministic test address #i (1..255)."""
    return Address(bytes([i]) * 20)


def hexa(i):
    return A(i).as_hex


DEPLOYER, PROPOSER = A(1), A(2)
ADMIN1, ADMIN2, ADMIN3, ADMIN4, ADMIN5 = A(11), A(12), A(13), A(14), A(15)
ADMIN_ADDR = A(99)


def ai(response):
    """Set what the fake LLM returns: a string, or fn(prompt) -> string."""
    G.PROMPT_HANDLER["fn"] = response if callable(response) else (lambda task: response)


# ---------------------------------------------------------------- environment
class Env:
    """A tiny chain: a clock plus transaction/view helpers with rollback."""

    def __init__(self, now=T0):
        self.now = now
        G.PROMPTS.clear()
        G.EVM.clear()
        G.NATIVE.clear()
        G.TRACES.clear()
        ai(ACCEPT)
        G.set_time(now)

    def at(self, ts):
        self.now = ts
        G.set_time(ts)

    def advance(self, secs):
        self.at(self.now + secs)

    def send(self, contract, method, *args, sender=None, at=None):
        """A write transaction: rolled back completely if it raises."""
        if at is not None:
            self.at(at)
        return G.tx(contract, getattr(contract, method), *args,
                    sender=sender, now=self.now)

    def view(self, contract, method, *args):
        G.set_time(self.now)
        return getattr(contract, method)(*args)


class GovTestCase(unittest.TestCase):
    """Base class: fresh Env per test plus builders and assertion helpers."""

    def setUp(self):
        self.env = Env()

    # ------------------------------------------------------------ assertions
    @contextmanager
    def reverts(self, contains=""):
        try:
            yield
        except gl.vm.UserError as e:
            self.assertIn(contains.lower(), str(e).lower(),
                          f"reverted, but with a different message: {e}")
            return
        self.fail(f"expected a revert containing {contains!r}")

    def send_reverts(self, contains, *a, **k):
        with self.reverts(contains):
            self.env.send(*a, **k)

    # ------------------------------------------------------------- builders
    def new_admin(self, n_admins=3):
        """A GovLayerAdmin with n_admins active admins (2..5) via the real flow."""
        env = self.env
        G._Msg.sender_address = ADMIN1
        admin = ADMIN.GovLayerAdmin()
        env.send(admin, "add_admin", ADMIN2.as_hex, sender=ADMIN1)
        extra = [ADMIN3, ADMIN4, ADMIN5]
        for newcomer in extra[: max(0, n_admins - 2)]:
            aid = env.send(admin, "propose_add_admin", newcomer.as_hex, sender=ADMIN1)
            for approver in (ADMIN2, ADMIN3, ADMIN4):      # as many approvals as the current threshold needs
                if admin.get_action(aid)["status"] == "timelocked":
                    break
                if admin.is_admin(approver.as_hex):
                    env.send(admin, "approve_admin_action", aid, sender=approver)
            env.advance(TIMELOCK)
            env.send(admin, "execute_admin_action", aid, sender=A(200))
        return admin

    def new_core(self, eligibility="open", weight="equal", admin=None, wire=True,
                 fake_admin=False):
        """A GovLayerCore, optionally wired to `admin` (or to a FakeAdmin)."""
        env = self.env
        G._Msg.sender_address = DEPLOYER
        core = CORE.GovLayerCore(GENESIS, eligibility, 0, 0, weight)
        core.max_proposals_per_window = 1000     # keep rate limiting out of the way
        if fake_admin:
            admin = FakeAdmin()
        if admin is not None:
            G.NATIVE[ADMIN_ADDR.as_hex] = admin
            if wire:
                env.send(core, "set_admin_contract_address", ADMIN_ADDR.as_hex, sender=DEPLOYER)
        self.admin = admin
        return core

    def new_pair(self, n_admins=3, eligibility="open", weight="equal"):
        """Real Admin + real Core, wired together."""
        admin = self.new_admin(n_admins)
        core = self.new_core(eligibility, weight, admin=admin)
        return core, admin

    def authorize(self, admin, method, *args, proposer=ADMIN1, approver=ADMIN2):
        """Propose + approve an Admin action; returns (action_id, ready_at)."""
        aid = self.env.send(admin, method, *args, sender=proposer)
        self.env.send(admin, "approve_admin_action", aid, sender=approver)
        return aid, int(admin.get_action(aid)["ready_at"])

    def execute(self, admin, aid):
        """Wait out the timelock (if needed) and execute on Admin."""
        ready = int(admin.get_action(aid)["ready_at"])
        if self.env.now < ready:
            self.env.at(ready)
        self.env.send(admin, "execute_admin_action", aid, sender=A(200))

    def authorize_and_execute(self, admin, method, *args, **kw):
        aid, _ = self.authorize(admin, method, *args, **kw)
        self.execute(admin, aid)
        return aid

    def apply(self, core, aid, at=None):
        self.env.send(core, "apply_admin_action", aid, sender=A(201), at=at)

    def submit(self, core, title="Fund the library", desc="Because reading is good.",
               ptype="standard", amend="", sender=PROPOSER, dur=HOUR, at=None):
        self.env.send(core, "submit_proposal", title, desc, dur, ptype, amend,
                      sender=sender, at=at)
        return int(core.proposal_count)

    def cast(self, core, pid, support, voters, at=None):
        for v in voters:
            self.env.send(core, "vote", pid, support, sender=A(v) if isinstance(v, int) else v, at=at)

    def finalize(self, core, pid, at=None):
        self.env.send(core, "finalize_decision", pid, sender=A(202),
                      at=at if at is not None else int(core.get_proposal(pid)["voting_closes_at"]) + 1)


class FakeAdmin:
    """Minimal stand-in for GovLayerAdmin when a test needs a hand-made action record."""

    def __init__(self):
        self.actions = {}
        self.paused = False
        self.count = 2

    def is_paused(self):
        return self.paused

    def get_active_admin_count(self):
        return self.count

    def get_action(self, aid):
        if aid not in self.actions:
            raise gl.vm.UserError("Action not found")
        return self.actions[aid]


def event_details(core, event_type):
    return [e["details"] for e in core.get_governance_history(0, 1000)
            if e["event_type"] == event_type]
