"""GovLayerCore <- GovLayerAdmin: wiring, applying every action type, rejection
paths, and the ordering / expiry rules.

Most tests use the REAL GovLayerAdmin (real multisig, real timelock, real
`ready_at` values) wired to the real GovLayerCore. Tests that need a malformed
or hand-crafted action record use FakeAdmin instead."""
import itertools
import json
import unittest

from helpers import (A, ADMIN, ADMIN1, ADMIN2, ADMIN_ADDR, CORE, DAY, DEPLOYER, HOUR, PROPOSER,
                     T0, TIMELOCK, VALIDITY, GovTestCase, event_details, ACCEPT, REVISE, hexa, G)

VP = (4, 70, HOUR, 10 * DAY)          # min_quorum, threshold, min/max voting duration
VP2 = (5, 80, HOUR, 10 * DAY)


class Wiring(GovTestCase):
    def test_wrong_address_reverts_and_nothing_is_wired(self):
        core = self.new_core(fake_admin=True, wire=False)
        self.send_reverts("did not answer", core, "set_admin_contract_address", A(50).as_hex, sender=DEPLOYER)
        self.assertFalse(core.is_admin_contract_configured())

    def test_admin_with_zero_admins_is_refused(self):
        core = self.new_core(fake_admin=True, wire=False)
        self.admin.count = 0
        self.send_reverts("does not look like", core, "set_admin_contract_address", ADMIN_ADDR.as_hex, sender=DEPLOYER)

    def test_zero_address_and_malformed_address_refused(self):
        core = self.new_core(fake_admin=True, wire=False)
        self.send_reverts("zero address", core, "set_admin_contract_address", "0x" + "00" * 20, sender=DEPLOYER)
        with self.assertRaises(Exception):                 # garbage input: any failed tx is acceptable
            self.env.send(core, "set_admin_contract_address", "not-an-address", sender=DEPLOYER)
        self.assertFalse(core.is_admin_contract_configured())

    def test_only_deployer_and_only_once(self):
        core = self.new_core(fake_admin=True, wire=False)
        self.send_reverts("deployer", core, "set_admin_contract_address", ADMIN_ADDR.as_hex, sender=A(7))
        self.env.send(core, "set_admin_contract_address", ADMIN_ADDR.as_hex, sender=DEPLOYER)
        self.assertTrue(core.is_admin_contract_configured())
        self.send_reverts("already configured", core, "set_admin_contract_address", ADMIN_ADDR.as_hex, sender=DEPLOYER)

    def test_real_admin_passes_the_wiring_check(self):
        core, admin = self.new_pair(3)
        self.assertTrue(core.is_admin_contract_configured())
        self.assertEqual(core.get_config()["admin_contract_address"].lower(), ADMIN_ADDR.as_hex)

    def test_unwired_core_cannot_pull_and_fails_closed_on_submit(self):
        core = self.new_core(fake_admin=True, wire=False)
        self.send_reverts("not configured", core, "apply_admin_action", "ACTION-00000001", sender=A(9))
        self.send_reverts("", core, "submit_proposal", "t", "d", HOUR, "standard", "", sender=PROPOSER)


class ApplyEveryActionType(GovTestCase):
    """One end-to-end pull per Core-applied action type, through the real Admin."""

    def setUp(self):
        super().setUp()
        self.core, self.admin = self.new_pair(3)

    def run_action(self, method, *args):
        aid = self.authorize_and_execute(self.admin, method, *args)
        self.apply(self.core, aid)
        self.assertTrue(self.core.is_admin_action_applied(aid))
        return aid

    def test_rate_limit_params(self):
        aid = self.run_action("propose_set_rate_limit_params", 5, 7200)
        cfg = self.core.get_config()
        self.assertEqual((cfg["max_proposals_per_window"], cfg["proposal_rate_window_secs"]), (5, 7200))
        self.assertTrue(any(aid in d for d in event_details(self.core, CORE.EVENT_ADMIN_ACTION_APPLIED)))

    def test_eligibility_mode(self):
        self.run_action("propose_set_eligibility_mode", "erc20")
        self.assertEqual(self.core.get_config()["eligibility_mode"], "erc20")

    def test_token_rules(self):
        self.run_action("propose_set_token_rules", A(60).as_hex, 10, 20, "erc20")
        cfg = self.core.get_config()
        self.assertEqual(cfg["voting_token"].lower(), A(60).as_hex)
        self.assertEqual((cfg["min_tokens_to_vote"], cfg["min_tokens_to_propose"],
                          cfg["custom_token_interface_kind"]), (10, 20, "erc20"))

    def test_voting_weight_mode(self):
        self.run_action("propose_set_voting_weight_mode", "token_weighted")
        self.assertEqual(self.core.get_config()["voting_weight_mode"], "token_weighted")

    def test_whitelist_enabled_voting_and_proposing(self):
        self.run_action("propose_set_whitelist_enabled", "voting", True)
        self.run_action("propose_set_whitelist_enabled", "proposing", True)
        cfg = self.core.get_config()
        self.assertTrue(cfg["use_whitelist_for_voting"] and cfg["use_whitelist_for_proposing"])
        self.run_action("propose_set_whitelist_enabled", "voting", False)
        self.assertFalse(self.core.get_config()["use_whitelist_for_voting"])

    def test_update_whitelist_add_and_remove(self):
        self.run_action("propose_update_whitelist", "voter", [hexa(30), hexa(31)], [])
        self.assertTrue(self.core.is_voter_whitelisted(A(30)) and self.core.is_voter_whitelisted(A(31)))
        self.run_action("propose_update_whitelist", "voter", [], [hexa(31)])
        self.assertTrue(self.core.is_voter_whitelisted(A(30)))
        self.assertFalse(self.core.is_voter_whitelisted(A(31)))
        self.run_action("propose_update_whitelist", "proposer", [hexa(40)], [])
        self.assertTrue(self.core.is_proposer_whitelisted(A(40)))
        self.assertIn(hexa(30), [x.lower() for x in self.core.get_voter_whitelist(0, 10)])
        self.assertIn(hexa(40), [x.lower() for x in self.core.get_proposer_whitelist(0, 10)])

    def test_voting_parameters(self):
        self.run_action("propose_set_voting_parameters", *VP)
        cfg = self.core.get_config()
        self.assertEqual((cfg["min_quorum"], cfg["approval_threshold_percent"],
                          cfg["min_voting_duration"], cfg["max_voting_duration"]), VP)

    def test_new_parameters_reach_new_proposals_only(self):
        pid = self.submit(self.core)
        self.run_action("propose_set_voting_parameters", *VP)
        old, new = self.core.get_proposal(pid), self.core.get_proposal(self.submit(self.core))
        self.assertEqual((old["quorum_required"], old["approval_threshold_percent"]), (3, 60))
        self.assertEqual((new["quorum_required"], new["approval_threshold_percent"]), (4, 70))


class PullGuards(GovTestCase):
    """Replay, not-executed, unknown ids, malformed payloads (hand-made records)."""

    def setUp(self):
        super().setUp()
        self.core = self.new_core(fake_admin=True)

    def fake(self, aid, atype, params, ready_at=None, status="executed"):
        self.admin.actions[aid] = {
            "status": status, "action_type": atype, "proposer": hexa(11),
            "params": params if isinstance(params, str) else json.dumps(params),
            "ready_at": self.env.now if ready_at is None else ready_at,
        }

    def rejected(self, aid):
        return bool(self.core.rejected_admin_action_ids.get(aid))

    def settings(self):
        """get_config minus the event counter (a rejection legitimately logs an event)."""
        cfg = dict(self.core.get_config())
        cfg.pop("governance_history_count")
        return cfg

    def test_replay_is_refused(self):
        self.fake("ACTION-1", "set_eligibility_mode", {"eligibility_mode": "nft"})
        self.apply(self.core, "ACTION-1")
        self.send_reverts("already applied", self.core, "apply_admin_action", "ACTION-1", sender=A(9))

    def test_unknown_action_id(self):
        self.send_reverts("does not exist", self.core, "apply_admin_action", "ACTION-404", sender=A(9))

    def test_unexecuted_action_is_not_pulled(self):
        for status in ("pending_approvals", "timelocked", "expired"):
            self.fake("ACTION-" + status, "set_eligibility_mode", {"eligibility_mode": "nft"}, status=status)
            self.send_reverts("not yet executed", self.core, "apply_admin_action", "ACTION-" + status, sender=A(9))

    def test_unknown_action_type_reverts(self):
        self.fake("ACTION-1", "nuke_everything", {})
        self.send_reverts("unknown action_type", self.core, "apply_admin_action", "ACTION-1", sender=A(9))
        self.assertFalse(self.rejected("ACTION-1"))

    def test_admin_unreachable_reverts_retryably(self):
        del G.NATIVE[ADMIN_ADDR.as_hex]
        self.send_reverts("unable to reach", self.core, "apply_admin_action", "ACTION-1", sender=A(9))

    def test_malformed_payloads_are_rejected_terminally(self):
        cases = {
            "set_rate_limit_params": [{"max_proposals_per_window": 0, "proposal_rate_window_secs": 7200},
                                      {"max_proposals_per_window": 5, "proposal_rate_window_secs": 1},
                                      {"max_proposals_per_window": "x"}, "not json", []],
            "set_eligibility_mode": [{"eligibility_mode": "bogus"}, {}, "[]"],
            "set_voting_weight_mode": [{"voting_weight_mode": "bogus"}, {}],
            "set_token_rules": [{"voting_token": "nope", "min_tokens_to_vote": 1, "min_tokens_to_propose": 1},
                                {"voting_token": hexa(60), "min_tokens_to_vote": -1, "min_tokens_to_propose": 1},
                                {"voting_token": hexa(60), "min_tokens_to_vote": 1, "min_tokens_to_propose": 1,
                                 "custom_token_interface_kind": "erc1155"}],
            "set_whitelist_enabled": [{"target": "everyone", "enabled": True},
                                      {"target": "voting", "enabled": "yes"}],
            "update_whitelist": [{"target": "nobody", "add": [], "remove": []},
                                 {"target": "voter", "add": ["bad"], "remove": []},
                                 {"target": "voter", "add": [hexa(i) for i in range(1, 52)], "remove": []},
                                 {"target": "voter", "add": "x", "remove": []}],
            "set_voting_parameters": [{"min_quorum": 2, "approval_threshold_percent": 70,
                                       "min_voting_duration": HOUR, "max_voting_duration": DAY},
                                      {"min_quorum": 4, "approval_threshold_percent": 50,
                                       "min_voting_duration": HOUR, "max_voting_duration": DAY},
                                      {"min_quorum": 4, "approval_threshold_percent": 101,
                                       "min_voting_duration": HOUR, "max_voting_duration": DAY},
                                      {"min_quorum": 4, "approval_threshold_percent": 70,
                                       "min_voting_duration": DAY, "max_voting_duration": HOUR},
                                      {"min_quorum": 4}],
        }
        n = 0
        for atype, payloads in cases.items():
            for payload in payloads:
                n += 1
                aid = f"ACTION-BAD-{n}"
                self.fake(aid, atype, payload)
                before = self.settings()
                self.apply(self.core, aid)                       # rejection is a successful, recorded tx
                self.assertTrue(self.rejected(aid), (atype, payload))
                self.assertFalse(self.core.is_admin_action_applied(aid))
                self.assertEqual(self.settings(), before, "a rejected pull must not change any setting")
                self.send_reverts("already rejected", self.core, "apply_admin_action", aid, sender=A(9))
        self.assertGreater(len(event_details(self.core, CORE.EVENT_ADMIN_ACTION_PULL_REJECTED)), 20)

    def test_an_address_in_both_lists_of_one_action_ends_removed(self):
        self.admin.actions["ACTION-1"] = {"status": "executed", "action_type": "update_whitelist", "proposer": hexa(11),
                                          "params": json.dumps({"target": "voter", "add": [hexa(30), hexa(31)], "remove": [hexa(30)]}),
                                          "ready_at": self.env.now}
        self.apply(self.core, "ACTION-1")
        self.assertFalse(self.core.is_voter_whitelisted(A(30)))              # remove wins the ambiguity
        self.assertTrue(self.core.is_voter_whitelisted(A(31)))
        self.assertTrue(any(d.endswith("added=1,removed=1") for d in event_details(self.core, CORE.EVENT_ADMIN_ACTION_APPLIED)))

    def test_batch_boundary_of_50_is_accepted(self):
        self.fake("ACTION-1", "update_whitelist", {"target": "voter", "add": [hexa(i) for i in range(1, 51)], "remove": []})
        self.apply(self.core, "ACTION-1")
        self.assertTrue(self.core.is_admin_action_applied("ACTION-1"))


class ConstitutionAmendmentFlow(GovTestCase):
    def setUp(self):
        super().setUp()
        self.core, self.admin = self.new_pair(3)

    def passed_amendment(self, text):
        pid = self.submit(self.core, title="Amend", ptype="constitution", amend=text)
        self.cast(self.core, pid, True, [10, 11, 12])
        self.finalize(self.core, pid)
        self.assertEqual(self.core.get_proposal(pid)["status"], "pending_constitution_confirm")
        return pid

    def test_full_flow_updates_constitution_and_history(self):
        pid = self.passed_amendment("NEW CONSTITUTION V2")
        aid = self.authorize_and_execute(self.admin, "propose_constitution_update", pid)
        self.apply(self.core, aid)
        self.assertEqual(self.core.get_proposal(pid)["status"], "passed")
        self.assertEqual(self.core.get_config()["constitution_version"], 2)
        hist = self.core.get_constitution_history(0, 10)
        self.assertEqual([h["version"] for h in hist], [1, 2])
        self.assertEqual(hist[1]["text"], "NEW CONSTITUTION V2")
        self.assertEqual(hist[1]["adopted_via_proposal_id"], pid)
        self.assertTrue(any("Constitution updated to version 2" in d for d in
                            event_details(self.core, CORE.EVENT_CONSTITUTION_UPDATE_APPLIED)))

    def test_stale_amendment_is_rejected_not_applied(self):
        p1 = self.passed_amendment("AMENDMENT ONE")
        p2 = self.passed_amendment("AMENDMENT TWO")
        a1 = self.authorize_and_execute(self.admin, "propose_constitution_update", p1)
        a2 = self.authorize_and_execute(self.admin, "propose_constitution_update", p2)
        self.apply(self.core, a1)
        self.apply(self.core, a2)
        self.assertEqual(self.core.constitution, "AMENDMENT ONE")
        self.assertTrue(self.core.rejected_admin_action_ids.get(a2))
        self.assertTrue(any("constitution changed" in d for d in
                            event_details(self.core, CORE.EVENT_ADMIN_ACTION_PULL_REJECTED)))
        self.assertEqual(self.core.get_proposal(p2)["status"], "pending_constitution_confirm")

    def test_action_for_missing_or_wrong_proposal_is_rejected(self):
        std = self.submit(self.core)                                   # standard, not constitution
        for target in (std, 999):
            aid = self.authorize_and_execute(self.admin, "propose_constitution_update", target)
            self.apply(self.core, aid)
            self.assertTrue(self.core.rejected_admin_action_ids.get(aid))
        self.assertEqual(self.core.get_config()["constitution_version"], 1)

    def test_constitution_update_cannot_apply_before_the_vote_passes(self):
        pid = self.submit(self.core, ptype="constitution", amend="X")   # still pending
        aid = self.authorize_and_execute(self.admin, "propose_constitution_update", pid)
        self.apply(self.core, aid)
        self.assertTrue(self.core.rejected_admin_action_ids.get(aid))
        self.assertEqual(self.core.constitution, "We govern fairly. Rule 1: no harm.")


class ActionOrdering(GovTestCase):
    """Actions overwriting the same setting apply in authorization
    order (ready_at, then action id); an older one arriving late is refused."""

    def setUp(self):
        super().setUp()
        self.core, self.admin = self.new_pair(3)

    def quorum(self):
        return self.core.get_config()["min_quorum"]

    def superseded(self):
        return [d for d in event_details(self.core, CORE.EVENT_ADMIN_ACTION_PULL_REJECTED) if "superseded" in d]

    def two_actions(self, gap=HOUR):
        a, _ = self.authorize(self.admin, "propose_set_voting_parameters", *VP)
        self.env.advance(gap)
        b, _ = self.authorize(self.admin, "propose_set_voting_parameters", *VP2)
        self.execute(self.admin, b)
        self.execute(self.admin, a)
        return a, b

    def test_in_order_application_works(self):
        a, b = self.two_actions()
        self.apply(self.core, a)
        self.apply(self.core, b)
        self.assertEqual(self.quorum(), 5)
        self.assertTrue(self.core.is_admin_action_applied(a) and self.core.is_admin_action_applied(b))

    def test_older_action_applied_after_newer_is_refused(self):
        a, b = self.two_actions()
        self.apply(self.core, b)
        self.apply(self.core, a)                                       # stale -> rejected, not reverted
        self.assertEqual(self.quorum(), 5, "the newer authorization must win")
        self.assertFalse(self.core.is_admin_action_applied(a))
        self.assertTrue(self.core.rejected_admin_action_ids.get(a))
        self.assertEqual(len(self.superseded()), 1)

    def test_order_follows_authorization_time_not_creation_order(self):
        a = self.env.send(self.admin, "propose_set_voting_parameters", *VP, sender=ADMIN1)        # created first
        self.env.advance(30 * 60)
        b = self.env.send(self.admin, "propose_set_voting_parameters", *VP2, sender=ADMIN1)       # created second
        self.env.send(self.admin, "approve_admin_action", b, sender=ADMIN2)                       # b authorized first
        self.env.advance(2 * HOUR)
        self.env.send(self.admin, "approve_admin_action", a, sender=ADMIN2)                       # a authorized later
        self.assertLess(a, b)                                                                     # a has the lower id
        self.assertGreater(self.admin.get_action(a)["ready_at"], self.admin.get_action(b)["ready_at"])
        self.execute(self.admin, a)
        self.execute(self.admin, b)
        self.apply(self.core, a)                                       # the later authorization applies first
        self.apply(self.core, b)                                       # so the earlier one is now superseded
        self.assertEqual(self.quorum(), 4)
        self.assertTrue(self.core.rejected_admin_action_ids.get(b))

    def test_same_ready_at_falls_back_to_action_id_order(self):
        a = self.env.send(self.admin, "propose_set_voting_parameters", *VP, sender=ADMIN1)
        b = self.env.send(self.admin, "propose_set_voting_parameters", *VP2, sender=ADMIN1)
        self.env.send(self.admin, "approve_admin_action", a, sender=ADMIN2)
        self.env.send(self.admin, "approve_admin_action", b, sender=ADMIN2)
        self.assertEqual(self.admin.get_action(a)["ready_at"], self.admin.get_action(b)["ready_at"])
        self.execute(self.admin, a)
        self.execute(self.admin, b)
        self.apply(self.core, b)
        self.apply(self.core, a)
        self.assertEqual(self.quorum(), 5)
        self.assertTrue(self.core.rejected_admin_action_ids.get(a))

    def test_rejected_supersession_is_terminal(self):
        a, b = self.two_actions()
        self.apply(self.core, b)
        self.apply(self.core, a)
        self.send_reverts("already rejected", self.core, "apply_admin_action", a, sender=A(9))

    def test_different_settings_do_not_block_each_other(self):
        older, _ = self.authorize(self.admin, "propose_set_eligibility_mode", "erc20")
        self.env.advance(HOUR)
        newer, _ = self.authorize(self.admin, "propose_set_voting_weight_mode", "token_weighted")
        self.execute(self.admin, newer)
        self.execute(self.admin, older)
        self.apply(self.core, newer)
        self.apply(self.core, older)                                   # different family: still fine
        cfg = self.core.get_config()
        self.assertEqual((cfg["eligibility_mode"], cfg["voting_weight_mode"]), ("erc20", "token_weighted"))
        self.assertEqual(self.superseded(), [])

    def test_whitelist_targets_are_independent_families(self):
        older, _ = self.authorize(self.admin, "propose_update_whitelist", "proposer", [hexa(40)], [])
        self.env.advance(HOUR)
        newer, _ = self.authorize(self.admin, "propose_update_whitelist", "voter", [hexa(30)], [])
        self.execute(self.admin, newer)
        self.execute(self.admin, older)
        self.apply(self.core, newer)
        self.apply(self.core, older)
        self.assertTrue(self.core.is_voter_whitelisted(A(30)) and self.core.is_proposer_whitelisted(A(40)))

    def test_whitelist_enable_flag_is_ordered_per_target(self):
        older, _ = self.authorize(self.admin, "propose_set_whitelist_enabled", "voting", True)
        self.env.advance(HOUR)
        newer, _ = self.authorize(self.admin, "propose_set_whitelist_enabled", "voting", False)
        self.execute(self.admin, newer)
        self.execute(self.admin, older)
        self.apply(self.core, newer)
        self.apply(self.core, older)
        self.assertFalse(self.core.get_config()["use_whitelist_for_voting"])

    def test_every_setting_family_is_ordered(self):
        pairs = [
            ("propose_set_rate_limit_params", (5, 7200), (6, 7200), "max_proposals_per_window", 6),
            ("propose_set_eligibility_mode", ("erc20",), ("nft",), "eligibility_mode", "nft"),
            ("propose_set_voting_weight_mode", ("token_weighted",), ("equal",), "voting_weight_mode", "equal"),
            ("propose_set_token_rules", (hexa(60), 1, 1, "erc20"), (hexa(61), 2, 2, "erc20"), "min_tokens_to_vote", 2),
        ]
        for method, old_args, new_args, key, want in pairs:
            old, _ = self.authorize(self.admin, method, *old_args)
            self.env.advance(HOUR)
            new, _ = self.authorize(self.admin, method, *new_args)
            self.execute(self.admin, new)
            self.execute(self.admin, old)
            self.apply(self.core, new)
            self.apply(self.core, old)
            self.assertEqual(self.core.get_config()[key], want, method)
            self.assertTrue(self.core.rejected_admin_action_ids.get(old), method)

    def test_constitution_updates_have_no_family(self):
        self.assertEqual(CORE.action_order_family("constitution_update_propose", "{}"), "")
        self.assertEqual(CORE.action_order_family("set_voting_parameters", "{}"), "set_voting_parameters")
        self.assertEqual(CORE.action_order_family("update_whitelist", '{"target":"voter"}'), "")        # per address instead
        self.assertEqual(CORE.action_order_family("set_whitelist_enabled", '{"target":"voting"}'), "set_whitelist_enabled:voting")
        self.assertEqual(CORE.action_order_family("set_whitelist_enabled", "garbage"), "set_whitelist_enabled:")


class WhitelistOrdering(GovTestCase):
    """Whitelist updates are ordered per ADDRESS, not as a batch. A later,
    unrelated action must never void an authorized removal, and the final list must
    not depend on the order in which the actions are pulled into Core."""

    WATCHED = (30, 31, 32)

    def setUp(self):
        super().setUp()
        self.core, self.admin = self.new_pair(3)

    def listed(self, core=None):
        core = core or self.core
        return {i: core.is_voter_whitelisted(A(i)) for i in self.WATCHED}

    def test_an_unrelated_later_action_cannot_void_an_authorized_removal(self):
        """The exact exploit: remove X (older), add Y (newer); the newer is applied first."""
        add_x = self.authorize_and_execute(self.admin, "propose_update_whitelist", "voter", [hexa(30)], [])
        self.apply(self.core, add_x)
        remove_x, _ = self.authorize(self.admin, "propose_update_whitelist", "voter", [], [hexa(30)])
        self.env.advance(HOUR)
        add_y, _ = self.authorize(self.admin, "propose_update_whitelist", "voter", [hexa(31)], [])
        self.execute(self.admin, add_y)
        self.execute(self.admin, remove_x)
        self.apply(self.core, add_y)                       # whoever pulls chooses the newer one first
        self.apply(self.core, remove_x)
        self.assertFalse(self.core.is_voter_whitelisted(A(30)), "the authorized removal must take effect")
        self.assertTrue(self.core.is_voter_whitelisted(A(31)))
        self.assertTrue(self.core.is_admin_action_applied(remove_x))
        self.assertFalse(self.core.rejected_admin_action_ids.get(remove_x))

    def test_same_address_newest_authorization_wins_whatever_the_pull_order(self):
        for first_applied in ("older", "newer"):
            self.setUp()
            older, _ = self.authorize(self.admin, "propose_update_whitelist", "voter", [hexa(30)], [])
            self.env.advance(HOUR)
            newer, _ = self.authorize(self.admin, "propose_update_whitelist", "voter", [], [hexa(30)])
            self.execute(self.admin, newer)
            self.execute(self.admin, older)
            order = (older, newer) if first_applied == "older" else (newer, older)
            for aid in order:
                self.apply(self.core, aid)
            self.assertFalse(self.core.is_voter_whitelisted(A(30)), first_applied)

    def test_a_superseded_instruction_is_skipped_but_the_rest_of_the_batch_applies(self):
        a, _ = self.authorize(self.admin, "propose_update_whitelist", "voter", [hexa(30), hexa(31)], [])
        self.env.advance(HOUR)
        b, _ = self.authorize(self.admin, "propose_update_whitelist", "voter", [], [hexa(30)])
        self.execute(self.admin, b)
        self.execute(self.admin, a)
        self.apply(self.core, b)
        self.apply(self.core, a)                           # 30 is superseded by b; 31 still applies
        self.assertEqual(self.listed(), {30: False, 31: True, 32: False})
        details = event_details(self.core, CORE.EVENT_ADMIN_ACTION_APPLIED)
        self.assertTrue(any(d.startswith(f"action:{a}|type:update_whitelist|target=voter,added=1,removed=0,superseded=1")
                            for d in details), details)
        self.assertTrue(any(d.endswith("added=0,removed=1") for d in details))        # no suffix when nothing is superseded
        self.assertTrue(self.core.is_admin_action_applied(a))

    def test_same_address_on_different_targets_is_independent(self):
        voter, _ = self.authorize(self.admin, "propose_update_whitelist", "voter", [hexa(30)], [])
        self.env.advance(HOUR)
        proposer, _ = self.authorize(self.admin, "propose_update_whitelist", "proposer", [hexa(30)], [])
        self.execute(self.admin, proposer)
        self.execute(self.admin, voter)
        self.apply(self.core, proposer)
        self.apply(self.core, voter)
        self.assertTrue(self.core.is_voter_whitelisted(A(30)) and self.core.is_proposer_whitelisted(A(30)))

    def test_set_whitelist_enabled_targets_are_independent_families(self):
        older, _ = self.authorize(self.admin, "propose_set_whitelist_enabled", "proposing", True)
        self.env.advance(HOUR)
        newer, _ = self.authorize(self.admin, "propose_set_whitelist_enabled", "voting", True)
        self.execute(self.admin, newer)
        self.execute(self.admin, older)
        self.apply(self.core, newer)
        self.apply(self.core, older)
        cfg = self.core.get_config()
        self.assertTrue(cfg["use_whitelist_for_voting"] and cfg["use_whitelist_for_proposing"])

    def scenario(self):
        """Four authorized updates over three addresses, authorized one hour apart."""
        plan = [([30, 31], []), ([], [31, 32]), ([32], []), ([], [30])]
        ids = []
        for add, remove in plan:
            aid, _ = self.authorize(self.admin, "propose_update_whitelist", "voter",
                                    [hexa(i) for i in add], [hexa(i) for i in remove])
            ids.append(aid)
            self.env.advance(HOUR)
        for aid in ids:
            self.execute(self.admin, aid)
        return ids

    def test_every_pull_order_gives_the_same_final_whitelist(self):
        expected = {30: False, 31: False, 32: True}         # newest instruction per address, by authorization time
        for perm in itertools.permutations(range(4)):
            self.env = type(self.env)()                     # fresh chain for each permutation
            self.core, self.admin = self.new_pair(3)
            ids = self.scenario()
            for i in perm:
                self.apply(self.core, ids[i])
            self.assertEqual(self.listed(), expected, f"pull order {perm}")
            self.assertTrue(all(self.core.is_admin_action_applied(a) for a in ids), perm)
        self.assertEqual(len(list(itertools.permutations(range(4)))), 24)


class ActionExpiry(GovTestCase):
    """An authorization is valid for VALIDITY seconds after its
    timelock ends, on both Admin (execute) and Core (apply)."""

    def setUp(self):
        super().setUp()
        self.core, self.admin = self.new_pair(3)

    def test_constants_are_in_lockstep(self):
        self.assertEqual(CORE.ACTION_VALIDITY_WINDOW_SECONDS, ADMIN.ACTION_VALIDITY_WINDOW_SECONDS)
        self.assertEqual(VALIDITY, 7 * DAY)

    def test_apply_at_the_last_second_of_the_window_succeeds(self):
        aid, ready = self.authorize(self.admin, "propose_set_eligibility_mode", "erc20")
        self.execute(self.admin, aid)
        self.apply(self.core, aid, at=ready + VALIDITY)
        self.assertEqual(self.core.get_config()["eligibility_mode"], "erc20")

    def test_apply_one_second_late_is_rejected(self):
        aid, ready = self.authorize(self.admin, "propose_set_eligibility_mode", "erc20")
        self.execute(self.admin, aid)
        self.apply(self.core, aid, at=ready + VALIDITY + 1)
        self.assertEqual(self.core.get_config()["eligibility_mode"], "open")
        self.assertTrue(self.core.rejected_admin_action_ids.get(aid))
        self.assertTrue(any("expired" in d for d in event_details(self.core, CORE.EVENT_ADMIN_ACTION_PULL_REJECTED)))

    def test_expired_constitution_authorization_can_be_re_proposed(self):
        pid = self.submit(self.core, ptype="constitution", amend="V2 TEXT")
        self.cast(self.core, pid, True, [10, 11, 12])
        self.finalize(self.core, pid)
        old, ready = self.authorize(self.admin, "propose_constitution_update", pid)
        self.execute(self.admin, old)
        self.apply(self.core, old, at=ready + VALIDITY + 1)              # too late: lapses
        self.assertEqual(self.core.get_proposal(pid)["status"], "pending_constitution_confirm")
        fresh, _ = self.authorize(self.admin, "propose_constitution_update", pid)   # recoverable
        self.execute(self.admin, fresh)
        self.apply(self.core, fresh)
        self.assertEqual(self.core.constitution, "V2 TEXT")

    def test_admin_refuses_to_execute_after_the_window_and_core_sees_it_unexecuted(self):
        aid, ready = self.authorize(self.admin, "propose_set_eligibility_mode", "nft")
        self.env.at(ready + VALIDITY + 1)
        self.env.send(self.admin, "execute_admin_action", aid, sender=A(9))     # graceful expiry, no revert
        self.assertEqual(self.admin.get_action(aid)["status"], "expired")
        self.send_reverts("not yet executed", self.core, "apply_admin_action", aid, sender=A(9))
        self.send_reverts("already finalized", self.admin, "execute_admin_action", aid, sender=A(9))

    def test_admin_executes_at_the_last_second_of_its_window(self):
        aid, ready = self.authorize(self.admin, "propose_set_eligibility_mode", "nft")
        self.env.at(ready + VALIDITY)
        self.env.send(self.admin, "execute_admin_action", aid, sender=A(9))
        self.assertEqual(self.admin.get_action(aid)["status"], "executed")

    def test_missing_or_zero_ready_at_is_treated_as_expired(self):
        core = self.new_core(fake_admin=True)
        for i, ra in enumerate((0, None)):
            rec = {"status": "executed", "action_type": "set_eligibility_mode", "proposer": hexa(11),
                   "params": json.dumps({"eligibility_mode": "nft"})}
            if ra is not None:
                rec["ready_at"] = ra
            self.admin.actions[f"A{i}"] = rec
            self.apply(core, f"A{i}")
            self.assertTrue(core.rejected_admin_action_ids.get(f"A{i}"))
        self.assertEqual(core.get_config()["eligibility_mode"], "open")


if __name__ == "__main__":
    unittest.main()
