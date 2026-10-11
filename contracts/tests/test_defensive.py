"""Defensive and error paths: corrupted stored state, malformed inputs, a bad
runtime clock, failed consensus rounds, and pagination edge cases. These are
conditions the public API cannot normally produce, so most tests corrupt storage
directly to prove the contracts fail safe rather than act on bad data."""
import json
import unittest

from helpers import (A, ADMIN, ADMIN1, ADMIN2, ADMIN_ADDR, APPROVAL_WINDOW, CORE, DAY, DEPLOYER, HOUR, PROPOSER,
                     T0, GovTestCase, FakeAdmin, G, ai, hexa, ACCEPT, REJECT, REVISE, DISPUTE_REJECT, GENESIS)


class AdminCorruptedStateFailsSafe(GovTestCase):
    """An action whose stored payload is damaged must expire, never execute."""

    CASES = [
        ("propose_set_rate_limit_params", (5, 7200)),
        ("propose_set_eligibility_mode", ("nft",)),
        ("propose_set_token_rules", (hexa(60), 1, 1, "")),
        ("propose_set_voting_weight_mode", ("token_weighted",)),
        ("propose_set_whitelist_enabled", ("voting", True)),
        ("propose_update_whitelist", ("voter", [hexa(1)], [])),
        ("propose_set_voting_parameters", (5, 70, HOUR, DAY)),
        ("propose_constitution_update", (5,)),
    ]

    def test_corrupt_payload_expires_instead_of_executing(self):
        for method, args in self.CASES:
            ad = self.new_admin(3)
            aid, ready = self.authorize(ad, method, *args)
            ad.pending_actions[aid].params = "garbage{"
            self.env.send(ad, "execute_admin_action", aid, sender=A(9), at=ready)
            self.assertEqual(ad.get_action(aid)["status"], "expired", method)

    def test_unknown_action_type_expires(self):
        ad = self.new_admin(3)
        aid, ready = self.authorize(ad, "propose_pause")
        ad.pending_actions[aid].action_type = "nuke"
        self.env.send(ad, "execute_admin_action", aid, sender=A(9), at=ready)
        self.assertEqual(ad.get_action(aid)["status"], "expired")
        self.assertFalse(ad.is_paused())

    def test_payloads_with_wrong_shapes_expire(self):
        bad = {"propose_set_whitelist_enabled": '{"target": "voting", "enabled": "yes"}',
               "propose_update_whitelist": '{"target": "voter", "add": "x", "remove": []}',
               "propose_set_token_rules": '{"voting_token": "zzz", "min_tokens_to_vote": 1, "min_tokens_to_propose": 1}',
               "propose_constitution_update": '{"proposal_id": 0}'}
        args = dict(self.CASES)
        for method, payload in bad.items():
            ad = self.new_admin(3)
            aid, ready = self.authorize(ad, method, *args[method])
            ad.pending_actions[aid].params = payload
            self.env.send(ad, "execute_admin_action", aid, sender=A(9), at=ready)
            self.assertEqual(ad.get_action(aid)["status"], "expired", method)

    def test_executing_a_pending_action_after_its_approval_window_expires_it(self):
        ad = self.new_admin(3)
        aid = self.env.send(ad, "propose_pause", sender=ADMIN1)
        before = int(ad.active_pending_action_count)
        self.env.send(ad, "execute_admin_action", aid, sender=A(9), at=self.env.now + APPROVAL_WINDOW + 1)
        self.assertEqual(ad.get_action(aid)["status"], "expired")
        self.assertEqual(int(ad.active_pending_action_count), before - 1)
        self.assertTrue(any("approval_window_elapsed" in t for t in G.TRACES))

    def test_garbage_addresses_are_refused(self):
        ad4 = self.new_admin(4)
        self.send_reverts("not a valid address", ad4, "propose_add_admin", "zzz", sender=ADMIN1)
        self.send_reverts("not a valid address", ad4, "propose_remove_admin", "zzz", sender=ADMIN1)
        G._Msg.sender_address = ADMIN1
        fresh = ADMIN.GovLayerAdmin()
        self.send_reverts("not a valid address", fresh, "add_admin", "zzz", sender=ADMIN1)

    def test_pending_action_listing_skips_finalized_actions(self):
        ad = self.new_admin(3)
        done, _ = self.authorize(ad, "propose_set_eligibility_mode", "nft")
        self.execute(ad, done)
        live1 = self.env.send(ad, "propose_set_eligibility_mode", "erc20", sender=ADMIN1)
        live2 = self.env.send(ad, "propose_set_voting_weight_mode", "token_weighted", sender=ADMIN1)
        listed = [a["action_id"] for a in ad.get_pending_actions(0, 10)]
        self.assertNotIn(done, listed)
        self.assertEqual([x for x in listed if x in (live1, live2)], [live1, live2])
        self.assertEqual([a["action_id"] for a in ad.get_pending_actions(1, 10)][:1], [live2])
        self.assertEqual(len(ad.get_pending_actions(0, 1)), 1)

    def test_bad_runtime_clock(self):
        ad = self.new_admin(3)
        for raw in ({"datetime": "1970-01-01T00:00:00Z"}, {}, {"datetime": "garbage"}):
            G.gl.message_raw = raw
            with self.reverts("timestamp"):
                ad._get_now()
        G.gl.message_raw = {"datetime": "2027-01-15T00:00:00"}                    # naive datetimes are read as UTC
        self.assertGreater(int(ad._get_now()), 1_700_000_000)


class CoreDefensivePaths(GovTestCase):
    def setUp(self):
        super().setUp()
        self.core = self.new_core(fake_admin=True)

    def test_bad_runtime_clock_stops_submission(self):
        for raw in ({"datetime": "1970-01-01T00:00:00Z"}, {}, {"datetime": "garbage"}):
            G.gl.message_raw = raw
            with self.reverts("timestamp"):
                G.tx(self.core, self.core.submit_proposal, "t", "d", HOUR, "standard", "", sender=PROPOSER)
        G.set_time(T0)
        G.gl.message_raw = {"datetime": "2027-01-15T00:00:00"}
        self.assertGreater(int(self.core._get_now()), 1_700_000_000)

    def test_bare_hex_admin_address_is_normalised(self):
        core = self.new_core(fake_admin=True, wire=False)
        self.env.send(core, "set_admin_contract_address", ADMIN_ADDR.as_hex[2:], sender=DEPLOYER)
        self.assertTrue(core.is_admin_contract_configured())
        self.assertEqual(CORE._normalize_hex_address_string("ab" * 20), "0x" + "ab" * 20)
        self.assertEqual(CORE._normalize_hex_address_string("0xabc"), "0xabc")

    def test_open_equal_balance_dispatch_returns_one(self):
        self.assertEqual(int(self.core._get_token_balance_or_raise(A(60), A(10))), 1)

    def test_admin_raising_another_user_error_is_treated_as_unreachable(self):
        def boom(aid): raise G.gl.vm.UserError("internal failure")
        self.admin.get_action = boom
        self.send_reverts("unable to reach", self.core, "apply_admin_action", "ACTION-1", sender=A(9))

    def test_constitution_action_with_garbage_proposal_id_is_rejected(self):
        for n, params in enumerate(('{"proposal_id": "abc"}', '{"proposal_id": -3}', "[]", "garbage")):
            aid = f"ACTION-{n}"
            self.admin.actions[aid] = {"status": "executed", "action_type": "constitution_update_propose",
                                       "proposer": hexa(11), "params": params, "ready_at": T0}
            self.apply(self.core, aid)
            self.assertTrue(self.core.rejected_admin_action_ids.get(aid), params)

    def test_finalize_refuses_a_proposal_that_was_never_accepted_by_the_ai(self):
        pid = self.submit(self.core)
        self.cast(self.core, pid, True, [10, 11, 12])
        p = self.core.proposals[str(pid)]
        p.ai_audit_decision = "reject"                                      # an impossible state, forced
        with self.reverts("invariant violated"):
            self.finalize(self.core, pid)
        self.assertEqual(self.core.get_proposal(pid)["status"], "pending")

    def test_whitelist_views_skip_removed_entries_and_honour_offset_and_limit(self):
        for target in ("voter", "proposer"):
            listing = getattr(self.core, f"{target}_whitelist_list")
            mapping = getattr(self.core, f"{target}_whitelist")
            for i in range(1, 7):
                listing.append(hexa(i))
                mapping[hexa(i)] = i not in (2, 5)                          # 2 and 5 were removed
        for getter in (self.core.get_voter_whitelist, self.core.get_proposer_whitelist):
            self.assertEqual(getter(0, 10), [hexa(1), hexa(3), hexa(4), hexa(6)])
            self.assertEqual(getter(1, 2), [hexa(3), hexa(4)])
            self.assertEqual(getter(3, 5), [hexa(6)])
            self.assertEqual(getter(9, 5), [])

    def test_constitution_history_pagination_handles_offsets(self):
        self.assertEqual(self.core.get_constitution_history(5, 5), [])
        self.assertEqual(len(self.core.get_constitution_history(0, 1)), 1)


class FailedConsensusRounds(GovTestCase):
    """If the leader round fails, or a validator cannot reproduce the result, the
    transaction aborts and nothing is recorded."""

    def setUp(self):
        super().setUp()
        self.core = self.new_core(fake_admin=True)

    def tearDown(self):
        G.vm.leader_fails = False

    def test_failed_leader_aborts_submission(self):
        G.vm.leader_fails = True
        with self.reverts("consensus"):
            self.env.send(self.core, "submit_proposal", "t", "d", HOUR, "standard", "", sender=PROPOSER)
        self.assertEqual(self.core.get_config()["proposal_count"], 0)

    def test_validator_that_errors_aborts_submission(self):
        calls = []
        def handler(task):
            calls.append(1)
            if len(calls) > 1:
                raise RuntimeError("validator LLM unavailable")
            return ACCEPT
        ai(handler)
        with self.reverts("consensus"):
            self.env.send(self.core, "submit_proposal", "t", "d", HOUR, "standard", "", sender=PROPOSER)
        self.assertEqual(self.core.get_config()["proposal_count"], 0)

    def test_failed_leader_aborts_a_dispute_and_leaves_the_proposal_rejected(self):
        ai(REJECT)
        pid = self.submit(self.core)
        G.vm.leader_fails = True
        with self.reverts("consensus"):
            self.env.send(self.core, "raise_dispute", pid, "reason", sender=PROPOSER)
        self.assertEqual((self.core.get_proposal(pid)["status"], self.core.get_proposal(pid)["dispute_stage"]), ("rejected", 0))

    def test_validator_that_errors_aborts_a_dispute(self):
        ai(REJECT)
        pid = self.submit(self.core)
        calls = []
        def handler(task):
            calls.append(1)
            if len(calls) > 1:
                raise RuntimeError("down")
            return DISPUTE_REJECT
        ai(handler)
        with self.reverts("consensus"):
            self.env.send(self.core, "raise_dispute", pid, "reason", sender=PROPOSER)
        self.assertEqual(self.core.get_proposal(pid)["dispute_stage"], 0)

    def test_a_dispute_where_leader_and_validator_disagree_aborts(self):
        ai(REJECT)
        pid = self.submit(self.core)
        answers = iter([DISPUTE_REJECT, '{"decision":"accept","reasoning":"x"}'])
        ai(lambda task: next(answers))
        with self.reverts("consensus"):
            self.env.send(self.core, "raise_dispute", pid, "reason", sender=PROPOSER)


if __name__ == "__main__":
    unittest.main()
