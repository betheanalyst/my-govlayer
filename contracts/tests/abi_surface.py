"""Collects the public surface of the two contracts: public method names and
parameter names, plus the key sets of the view results a frontend parses.

Used by tools/make_abi_snapshot.py (to record a baseline) and by
test_surface_freeze.py (to check the current contracts never drop or rename
anything in that baseline)."""
import inspect
import json

import helpers as h
from helpers import Env, G, A, ADMIN1, ADMIN2, GENESIS, DEPLOYER, PROPOSER, FakeAdmin, ADMIN_ADDR, ACCEPT, REVISE, REJECT, ai, HOUR


def methods(cls):
    out = {}
    for name, fn in inspect.getmembers(cls, inspect.isfunction):
        kind = getattr(fn, "_gl_public", None)
        if kind:
            params = [p for p in inspect.signature(fn).parameters if p != "self"]
            out[name] = {"kind": kind, "params": params}
    return out


def keys(obj):
    return sorted(obj.keys())


def collect(core_mod, admin_mod):
    env = Env()
    G._Msg.sender_address = DEPLOYER
    core = core_mod.GovLayerCore(GENESIS, "open", 0, 0, "equal")
    core.max_proposals_per_window = 1000
    G.NATIVE[ADMIN_ADDR.as_hex] = FakeAdmin()
    env.send(core, "set_admin_contract_address", ADMIN_ADDR.as_hex, sender=DEPLOYER)

    def submit(response):
        ai(response)
        env.send(core, "submit_proposal", "t", "d", HOUR, "standard", "", sender=PROPOSER)
        return int(core.get_config()["proposal_count"])

    live = submit(ACCEPT)
    revised = submit(REVISE)
    env.send(core, "resubmit_proposal", revised, "better", sender=PROPOSER)
    rejected = submit(REJECT)
    ai('{"decision":"reject","reasoning":"no"}')
    env.send(core, "raise_dispute", rejected, "why", sender=PROPOSER)
    env.send(core, "vote", live, True, sender=A(10))

    G._Msg.sender_address = ADMIN1
    admin = admin_mod.GovLayerAdmin()
    env.send(admin, "add_admin", ADMIN2.as_hex, sender=ADMIN1)
    aid = env.send(admin, "propose_set_eligibility_mode", "nft", sender=ADMIN1)

    surf = {
        "core_methods": methods(core_mod.GovLayerCore),
        "admin_methods": methods(admin_mod.GovLayerAdmin),
        "views": {
            "core.get_config": keys(core.get_config()),
            "core.get_proposal": keys(core.get_proposal(live)),
            "core.get_proposal.dispute_history[]": keys(core.get_proposal(rejected)["dispute_history"][0]),
            "core.get_proposal_revisions[]": keys(core.get_proposal_revisions(revised, 0, 10)[0]),
            "core.get_governance_history[]": keys(core.get_governance_history(0, 10)[0]),
            "core.get_constitution_history[]": keys(core.get_constitution_history(0, 10)[0]),
            "admin.get_action": keys(admin.get_action(aid)),
            "admin.get_pending_actions[]": keys(admin.get_pending_actions(0, 10)[0]),
            "admin.get_rate_limit_params": keys(admin.get_rate_limit_params()),
            "admin.get_dispute_safety_params": keys(admin.get_dispute_safety_params()),
        },
    }
    return json.loads(json.dumps(surf))
