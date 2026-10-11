"""GovLayerAdmin: bootstrap, membership, multisig thresholds, approval windows,
timelock, execution, the validity window, epoch invalidation, pause, and every
propose_* validator."""
import json
import unittest

from helpers import (A, ADMIN, ADMIN1, ADMIN2, ADMIN3, ADMIN4, ADMIN5, APPROVAL_WINDOW, DAY, HOUR, T0, TIMELOCK,
                     VALIDITY, GovTestCase, G, hexa)


class Bootstrap(GovTestCase):
    def fresh(self):
        G._Msg.sender_address = ADMIN1
        return ADMIN.GovLayerAdmin()

    def test_deployer_is_the_sole_admin_and_nothing_is_paused(self):
        ad = self.fresh()
        self.assertEqual((ad.is_bootstrap_complete(), ad.get_active_admin_count(), ad.is_paused()), (False, 1, False))
        self.assertEqual(ad.get_admins(), [ADMIN1.as_hex])
        self.assertTrue(ad.is_admin(ADMIN1.as_hex))
        self.assertFalse(ad.is_admin(ADMIN2.as_hex))
        self.assertTrue(any("ADMIN_BOOTSTRAP_INITIALIZED" in t for t in G.TRACES))

    def test_add_admin_rules(self):
        ad = self.fresh()
        self.send_reverts("only the current sole admin", ad, "add_admin", hexa(14), sender=ADMIN2)
        self.send_reverts("already admin", ad, "add_admin", ADMIN1.as_hex, sender=ADMIN1)
        self.send_reverts("zero address", ad, "add_admin", "0x" + "00" * 20, sender=ADMIN1)
        self.env.send(ad, "add_admin", ADMIN2.as_hex, sender=ADMIN1)
        self.assertEqual((ad.is_bootstrap_complete(), ad.get_active_admin_count(), ad.get_current_threshold()), (True, 2, 2))
        self.send_reverts("already complete", ad, "add_admin", hexa(15), sender=ADMIN1)

    def test_governance_actions_are_unavailable_during_bootstrap(self):
        ad = self.fresh()
        calls = [("propose_add_admin", hexa(14)), ("propose_remove_admin", hexa(14)), ("propose_constitution_update", 1),
                 ("propose_set_rate_limit_params", 5, 7200), ("propose_set_eligibility_mode", "nft"),
                 ("propose_set_token_rules", hexa(60), 0, 0, ""), ("propose_set_voting_weight_mode", "equal"),
                 ("propose_set_whitelist_enabled", "voting", True), ("propose_update_whitelist", "voter", [], []),
                 ("propose_set_voting_parameters", 3, 60, HOUR, DAY), ("propose_pause",), ("propose_unpause",)]
        for method, *args in calls:
            self.send_reverts("bootstrap not complete", ad, method, *args, sender=ADMIN1)


class Membership(GovTestCase):
    def test_threshold_table_for_every_size(self):
        for n, want in ((2, 2), (3, 2), (4, 3), (5, 3)):
            ad = self.new_admin(n)
            self.assertEqual((ad.get_active_admin_count(), ad.get_current_threshold()), (n, want), n)
            self.assertEqual(ad.get_current_threshold(), ADMIN.THRESHOLD_TABLE[n])

    def test_add_admin_limits(self):
        ad = self.new_admin(5)
        self.send_reverts("invalid", ad, "propose_add_admin", hexa(16), sender=ADMIN1)            # sixth seat
        ad3 = self.new_admin(3)
        self.send_reverts("already admin", ad3, "propose_add_admin", ADMIN1.as_hex, sender=ADMIN1)
        self.send_reverts("not admin", ad3, "propose_add_admin", hexa(16), sender=A(77))

    def test_removal_needs_four_admins_and_shrinks_the_threshold(self):
        self.send_reverts("starting from 4", self.new_admin(3), "propose_remove_admin", ADMIN3.as_hex, sender=ADMIN1)
        ad = self.new_admin(4)
        aid = self.env.send(ad, "propose_remove_admin", ADMIN4.as_hex, sender=ADMIN1)
        self.env.send(ad, "approve_admin_action", aid, sender=ADMIN2)
        self.assertEqual(ad.get_action(aid)["status"], "pending_approvals")                        # 2 of 3
        self.env.send(ad, "approve_admin_action", aid, sender=ADMIN3)
        self.assertEqual(ad.get_action(aid)["status"], "timelocked")
        self.execute(ad, aid)
        self.assertEqual((ad.get_active_admin_count(), ad.get_current_threshold(), ad.is_admin(ADMIN4.as_hex)), (3, 2, False))
        self.send_reverts("not admin", ad, "propose_set_eligibility_mode", "nft", sender=ADMIN4)
        self.send_reverts("not admin", ad, "approve_admin_action", self.env.send(ad, "propose_pause", sender=ADMIN1), sender=ADMIN4)

    def test_removing_a_non_admin_is_invalid(self):
        self.send_reverts("not an active admin", self.new_admin(4), "propose_remove_admin", hexa(99), sender=ADMIN1)

    def test_adding_an_admin_end_to_end(self):
        ad = self.new_admin(3)
        self.assertTrue(ad.is_admin(ADMIN3.as_hex))
        self.assertEqual(len(ad.get_admins()), 3)


class ApprovalAndTimelock(GovTestCase):
    def setUp(self):
        super().setUp()
        self.ad = self.new_admin(3)

    def propose(self):
        return self.env.send(self.ad, "propose_set_eligibility_mode", "nft", sender=ADMIN1)

    def test_new_action_shape(self):
        aid = self.propose()
        a = self.ad.get_action(aid)
        self.assertEqual((a["status"], a["valid_approvals_now"], a["current_threshold"], a["ready_at"], a["threshold_reached_at"]),
                         ("pending_approvals", 1, 2, 0, 0))
        self.assertEqual((a["proposer"], a["expires_at"] - a["proposed_at"]), (ADMIN1.as_hex, APPROVAL_WINDOW))
        self.assertEqual(json.loads(a["params"]), {"eligibility_mode": "nft"})

    def test_reaching_the_threshold_starts_the_timelock(self):
        aid = self.propose()
        self.env.send(self.ad, "approve_admin_action", aid, sender=ADMIN2)
        a = self.ad.get_action(aid)
        self.assertEqual((a["status"], a["ready_at"], a["threshold_reached_at"]), ("timelocked", T0 + DAY + TIMELOCK, T0 + DAY))
        self.send_reverts("approvals closed", self.ad, "approve_admin_action", aid, sender=ADMIN3)

    def test_who_may_approve(self):
        aid = self.propose()
        self.send_reverts("proposer cannot approve", self.ad, "approve_admin_action", aid, sender=ADMIN1)
        self.send_reverts("not admin", self.ad, "approve_admin_action", aid, sender=A(77))
        self.send_reverts("action not found", self.ad, "approve_admin_action", "ACTION-99999999", sender=ADMIN2)
        self.assertEqual(self.ad.get_action(aid)["valid_approvals_now"], 1)

    def test_no_double_approval(self):
        ad = self.new_admin(4)                                       # threshold 3, so a second approval does not finalize
        aid = self.env.send(ad, "propose_set_eligibility_mode", "nft", sender=ADMIN1)
        self.env.send(ad, "approve_admin_action", aid, sender=ADMIN2)
        self.send_reverts("already approved", ad, "approve_admin_action", aid, sender=ADMIN2)

    def test_execute_needs_threshold_then_timelock(self):
        aid = self.propose()
        self.send_reverts("threshold not reached", self.ad, "execute_admin_action", aid, sender=A(9))
        self.env.send(self.ad, "approve_admin_action", aid, sender=ADMIN2)
        ready = self.ad.get_action(aid)["ready_at"]
        self.send_reverts("timelock active", self.ad, "execute_admin_action", aid, sender=A(9), at=ready - 1)
        self.env.send(self.ad, "execute_admin_action", aid, sender=A(9), at=ready)            # permissionless, exact boundary
        self.assertEqual(self.ad.get_action(aid)["status"], "executed")

    def test_an_action_executes_only_once(self):
        aid, _ = self.authorize(self.ad, "propose_set_eligibility_mode", "nft")
        self.execute(self.ad, aid)
        self.send_reverts("already finalized", self.ad, "execute_admin_action", aid, sender=A(9))
        self.send_reverts("already finalized", self.ad, "approve_admin_action", aid, sender=ADMIN3)

    def test_unknown_action_id(self):
        self.send_reverts("action not found", self.ad, "execute_admin_action", "ACTION-99999999", sender=A(9))
        with self.reverts("action not found"):
            self.ad.get_action("ACTION-99999999")

    def test_approval_window_lapse_expires_gracefully(self):
        aid = self.propose()
        self.env.send(self.ad, "approve_admin_action", aid, sender=ADMIN2, at=T0 + DAY + APPROVAL_WINDOW + 1)
        a = self.ad.get_action(aid)
        self.assertEqual(a["status"], "expired")
        self.assertNotEqual(a["status"], "timelocked")
        self.send_reverts("already finalized", self.ad, "execute_admin_action", aid, sender=A(9))

    def test_action_ids_are_sequential_and_listed(self):
        ids = [self.propose() for _ in range(3)]
        self.assertEqual(ids, sorted(ids))
        listed = [a["action_id"] for a in self.ad.get_pending_actions(0, 100)]
        for aid in ids:
            self.assertIn(aid, listed)
        self.assertEqual(len(self.ad.get_pending_actions(0, 2)), 2)
        with self.reverts("greater than 0"):
            self.ad.get_pending_actions(0, 0)


class ValidityWindow(GovTestCase):
    """An authorization lapses VALIDITY seconds after its timelock ends."""

    def setUp(self):
        super().setUp()
        self.ad = self.new_admin(3)

    def test_constant(self):
        self.assertEqual(VALIDITY, 7 * DAY)

    def test_execution_at_the_last_second_succeeds(self):
        aid, ready = self.authorize(self.ad, "propose_set_eligibility_mode", "nft")
        self.env.send(self.ad, "execute_admin_action", aid, sender=A(9), at=ready + VALIDITY)
        self.assertEqual(self.ad.get_action(aid)["status"], "executed")

    def test_execution_one_second_late_expires_without_reverting(self):
        aid, ready = self.authorize(self.ad, "propose_set_eligibility_mode", "nft")
        self.env.send(self.ad, "execute_admin_action", aid, sender=A(9), at=ready + VALIDITY + 1)
        self.assertEqual(self.ad.get_action(aid)["status"], "expired")
        self.assertTrue(any("execution_window_elapsed" in t for t in G.TRACES))
        self.send_reverts("already finalized", self.ad, "execute_admin_action", aid, sender=A(9))

    def test_an_expired_action_frees_its_pending_slot_and_can_be_reproposed(self):
        before = int(self.ad.active_pending_action_count)
        aid, ready = self.authorize(self.ad, "propose_set_eligibility_mode", "nft")
        self.assertEqual(int(self.ad.active_pending_action_count), before + 1)
        self.env.send(self.ad, "execute_admin_action", aid, sender=A(9), at=ready + VALIDITY + 1)
        self.assertEqual(int(self.ad.active_pending_action_count), before)
        again, _ = self.authorize(self.ad, "propose_set_eligibility_mode", "nft")
        self.execute(self.ad, again)
        self.assertEqual(self.ad.get_action(again)["status"], "executed")


class RevalidationAndEpochs(GovTestCase):
    def test_removed_approver_no_longer_counts_and_the_action_can_still_complete(self):
        ad = self.new_admin(4)                                               # threshold 3
        rem = self.env.send(ad, "propose_remove_admin", ADMIN2.as_hex, sender=ADMIN1)
        self.env.send(ad, "approve_admin_action", rem, sender=ADMIN3)
        self.env.send(ad, "approve_admin_action", rem, sender=ADMIN4)        # timelocked, ready in 24h
        self.env.advance(10 * HOUR)
        x = self.env.send(ad, "propose_set_eligibility_mode", "nft", sender=ADMIN1)
        self.env.send(ad, "approve_admin_action", x, sender=ADMIN2)
        self.assertEqual(ad.get_action(x)["valid_approvals_now"], 2)
        self.execute(ad, rem)                                                # ADMIN2 leaves
        a = ad.get_action(x)
        self.assertEqual((a["valid_approvals_now"], a["current_threshold"], a["status"]), (1, 2, "pending_approvals"))
        self.env.send(ad, "approve_admin_action", x, sender=ADMIN3)
        self.assertEqual(ad.get_action(x)["status"], "timelocked")

    def test_timelocked_action_is_revalidated_at_execution(self):
        ad = self.new_admin(5)                                               # threshold 3
        x = self.env.send(ad, "propose_set_eligibility_mode", "nft", sender=ADMIN1)
        self.env.send(ad, "approve_admin_action", x, sender=ADMIN2)
        self.env.send(ad, "approve_admin_action", x, sender=ADMIN3)          # timelocked with approvals 1,2,3
        rem = self.env.send(ad, "propose_remove_admin", ADMIN2.as_hex, sender=ADMIN1)
        self.env.send(ad, "approve_admin_action", rem, sender=ADMIN3)
        self.env.send(ad, "approve_admin_action", rem, sender=ADMIN4)
        self.execute(ad, rem)                                                # ADMIN2 gone: 4 admins, threshold 3, x has 2
        self.env.send(ad, "execute_admin_action", x, sender=A(9))
        self.assertEqual(ad.get_action(x)["status"], "expired", "a timelocked action must not execute on stale approvals")
        self.assertFalse(ad.is_paused())

    def test_an_approval_from_an_earlier_tenure_does_not_count(self):
        ad = self.new_admin(4)
        x = self.env.send(ad, "propose_set_eligibility_mode", "nft", sender=ADMIN1)
        self.env.send(ad, "approve_admin_action", x, sender=ADMIN2)
        self.assertEqual(ad.get_action(x)["valid_approvals_now"], 2)
        ad.admin_epoch[ADMIN2.as_hex] = G.u256(int(ad.admin_epoch[ADMIN2.as_hex]) + 1)   # what removal + reinstatement does
        self.assertEqual(ad.get_action(x)["valid_approvals_now"], 1)
        self.env.send(ad, "approve_admin_action", x, sender=ADMIN2)                      # the new tenure may approve again
        self.assertEqual(ad.get_action(x)["valid_approvals_now"], 2)


class RacingMembershipActions(GovTestCase):
    """Two actions that were each valid when proposed can conflict at execution
    time; the second must expire rather than corrupt the admin set."""

    def approve_all(self, ad, aid, approvers):
        for who in approvers:
            if ad.get_action(aid)["status"] == "pending_approvals":
                self.env.send(ad, "approve_admin_action", aid, sender=who)

    def test_duplicate_add_expires_the_second(self):
        ad = self.new_admin(3)
        first = self.env.send(ad, "propose_add_admin", hexa(40), sender=ADMIN1)
        second = self.env.send(ad, "propose_add_admin", hexa(40), sender=ADMIN2)
        self.approve_all(ad, first, (ADMIN2, ADMIN3))
        self.approve_all(ad, second, (ADMIN1, ADMIN3))
        self.execute(ad, first)
        self.env.send(ad, "execute_admin_action", second, sender=A(9))
        self.assertEqual((ad.get_action(first)["status"], ad.get_action(second)["status"]), ("executed", "expired"))
        self.assertEqual(ad.get_active_admin_count(), 4)

    def test_adding_beyond_the_maximum_expires_the_second(self):
        ad = self.new_admin(4)
        a = self.env.send(ad, "propose_add_admin", hexa(40), sender=ADMIN1)
        b = self.env.send(ad, "propose_add_admin", hexa(41), sender=ADMIN1)
        self.approve_all(ad, a, (ADMIN2, ADMIN3, ADMIN4))
        self.approve_all(ad, b, (ADMIN2, ADMIN3, ADMIN4))
        self.execute(ad, a)
        self.env.send(ad, "execute_admin_action", b, sender=A(9))
        self.assertEqual((ad.get_active_admin_count(), ad.get_action(b)["status"]), (5, "expired"))

    def test_duplicate_removal_expires_the_second(self):
        ad = self.new_admin(5)
        a = self.env.send(ad, "propose_remove_admin", ADMIN5.as_hex, sender=ADMIN1)
        b = self.env.send(ad, "propose_remove_admin", ADMIN5.as_hex, sender=ADMIN2)
        self.approve_all(ad, a, (ADMIN2, ADMIN3, ADMIN4))
        self.approve_all(ad, b, (ADMIN1, ADMIN3, ADMIN4))
        self.execute(ad, a)
        self.env.send(ad, "execute_admin_action", b, sender=A(9))
        self.assertEqual((ad.get_active_admin_count(), ad.get_action(b)["status"]), (4, "expired"))

    def test_is_admin_rejects_garbage(self):
        ad = self.new_admin(3)
        with self.reverts("not a valid address"):
            ad.is_admin("zzz")


class Pause(GovTestCase):
    def setUp(self):
        super().setUp()
        self.ad = self.new_admin(3)

    def test_pause_and_unpause_cycle(self):
        self.send_reverts("not currently paused", self.ad, "propose_unpause", sender=ADMIN1)
        self.authorize_and_execute(self.ad, "propose_pause")
        self.assertTrue(self.ad.is_paused())
        self.send_reverts("already paused", self.ad, "propose_pause", sender=ADMIN1)
        self.authorize_and_execute(self.ad, "propose_unpause")
        self.assertFalse(self.ad.is_paused())

    def test_pause_takes_effect_only_at_execution(self):
        aid, ready = self.authorize(self.ad, "propose_pause")
        self.assertFalse(self.ad.is_paused())
        self.execute(self.ad, aid)
        self.assertTrue(self.ad.is_paused())

    def test_only_admins_propose(self):
        self.send_reverts("not admin", self.ad, "propose_pause", sender=A(77))
        self.send_reverts("not admin", self.ad, "propose_unpause", sender=A(77))


class ProposalValidation(GovTestCase):
    """Every propose_* validator rejects bad input and accepts the boundaries."""

    def setUp(self):
        super().setUp()
        self.ad = self.new_admin(3)

    def bad(self, method, *args, contains="proposal invalid"):
        before = len(self.ad.get_pending_actions(0, 1000))
        self.send_reverts(contains, self.ad, method, *args, sender=ADMIN1)
        self.assertEqual(len(self.ad.get_pending_actions(0, 1000)), before)

    def ok(self, method, *args):
        return self.env.send(self.ad, method, *args, sender=ADMIN1)

    def test_non_admins_are_refused_everywhere(self):
        for method, args in (("propose_set_rate_limit_params", (5, 7200)), ("propose_set_eligibility_mode", ("nft",)),
                             ("propose_set_token_rules", (hexa(60), 1, 1, "")), ("propose_set_voting_weight_mode", ("equal",)),
                             ("propose_set_whitelist_enabled", ("voting", True)), ("propose_update_whitelist", ("voter", [], [])),
                             ("propose_set_voting_parameters", (3, 60, HOUR, DAY)), ("propose_constitution_update", (1,)),
                             ("propose_add_admin", (hexa(40),)), ("propose_remove_admin", (hexa(40),))):
            self.send_reverts("not admin", self.ad, method, *args, sender=A(77))

    def test_rate_limit_bounds(self):
        self.bad("propose_set_rate_limit_params", 0, 7200)
        self.bad("propose_set_rate_limit_params", 1001, 7200)
        self.bad("propose_set_rate_limit_params", 5, 3599)
        self.bad("propose_set_rate_limit_params", 5, 30 * DAY + 1)
        self.ok("propose_set_rate_limit_params", 1, HOUR)
        self.ok("propose_set_rate_limit_params", 1000, 30 * DAY)

    def test_enumerated_settings(self):
        self.bad("propose_set_eligibility_mode", "everyone")
        self.bad("propose_set_voting_weight_mode", "whales")
        self.bad("propose_set_whitelist_enabled", "nobody", True)
        self.bad("propose_update_whitelist", "nobody", [], [])
        for mode in ("open", "erc20", "nft", "custom"):
            self.ok("propose_set_eligibility_mode", mode)
        for mode in ("equal", "token_weighted"):
            self.ok("propose_set_voting_weight_mode", mode)

    def test_token_rules(self):
        self.bad("propose_set_token_rules", "not-an-address", 1, 1, "")
        self.bad("propose_set_token_rules", hexa(60), -1, 1, "")
        self.bad("propose_set_token_rules", hexa(60), 1, -1, "")
        self.bad("propose_set_token_rules", hexa(60), 1, 1, "erc1155")
        aid = self.ok("propose_set_token_rules", hexa(60), 0, 0, "")
        self.assertEqual(json.loads(self.ad.get_action(aid)["params"])["voting_token"], hexa(60))
        self.ok("propose_set_token_rules", hexa(60), 10, 20, "erc20")

    def test_whitelist_update_batch_size(self):
        self.ok("propose_update_whitelist", "voter", [hexa(i) for i in range(1, 51)], [])
        self.bad("propose_update_whitelist", "voter", [hexa(i) for i in range(1, 52)], [])
        self.bad("propose_update_whitelist", "voter", ["garbage"], [])
        self.ok("propose_update_whitelist", "proposer", [hexa(1)], [hexa(2)])

    def test_voting_parameter_bounds(self):
        self.bad("propose_set_voting_parameters", 2, 60, HOUR, DAY)              # quorum floor is 3
        self.bad("propose_set_voting_parameters", 3, 50, HOUR, DAY)              # floor is 51: a 50/50 tie must not pass
        self.bad("propose_set_voting_parameters", 3, 101, HOUR, DAY)
        self.bad("propose_set_voting_parameters", 3, 60, HOUR - 1, DAY)
        self.bad("propose_set_voting_parameters", 3, 60, HOUR, 30 * DAY + 1)
        self.bad("propose_set_voting_parameters", 3, 60, DAY, HOUR)              # max < min
        self.ok("propose_set_voting_parameters", 3, 51, HOUR, 30 * DAY)
        self.ok("propose_set_voting_parameters", 1000, 100, DAY, DAY)
        self.assertEqual(ADMIN.MIN_APPROVAL_THRESHOLD_PERCENT, 51)

    def test_constitution_update_needs_a_positive_id(self):
        self.send_reverts("positive integer", self.ad, "propose_constitution_update", 0, sender=ADMIN1)
        aid = self.ok("propose_constitution_update", 7)
        self.assertEqual(json.loads(self.ad.get_action(aid)["params"]), {"proposal_id": 7})

    def test_views(self):
        self.assertEqual(self.ad.get_rate_limit_params(), {"max_proposals_per_window": 7, "proposal_rate_window_secs": 7 * DAY})
        self.assertEqual(self.ad.get_dispute_safety_params(),
                         {"max_resubmissions": 3, "dispute_cooldown_seconds": 3600, "max_dispute_stages_count": 3})

    def test_rate_limit_action_updates_admins_own_record(self):
        self.authorize_and_execute(self.ad, "propose_set_rate_limit_params", 9, 7200)
        self.assertEqual(self.ad.get_rate_limit_params(), {"max_proposals_per_window": 9, "proposal_rate_window_secs": 7200})


if __name__ == "__main__":
    unittest.main()
