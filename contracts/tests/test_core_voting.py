"""Voting, finalization, quorum semantics and per-proposal rule snapshots."""
import unittest

from helpers import (A, CORE, DAY, HOUR, PROPOSER, T0, GovTestCase, event_details, hexa, G, ACCEPT,
                     REJECT, REVISE, DISPUTE_ACCEPT, ai)

ONE = 10 ** 18


def evm_token(addr, balances):
    """Register an EVM-style token whose balanceOf reads `balances` {Address: int}."""
    G.EVM[addr.as_hex] = {"balanceOf": lambda owner: balances.get(owner, 0)}
    return addr


class VotingBasics(GovTestCase):
    def setUp(self):
        super().setUp()
        self.core = self.new_core(fake_admin=True)
        self.pid = self.submit(self.core)

    def test_vote_is_recorded_and_counted(self):
        self.cast(self.core, self.pid, True, [10])
        self.cast(self.core, self.pid, False, [11])
        p = self.core.get_proposal(self.pid)
        self.assertEqual((p["votes_yes"], p["votes_no"], p["voter_count"]), (1, 1, 2))

    def test_second_vote_is_refused_even_with_same_choice(self):
        self.cast(self.core, self.pid, True, [10])
        self.send_reverts("already voted", self.core, "vote", self.pid, True, sender=A(10))
        self.send_reverts("already voted", self.core, "vote", self.pid, False, sender=A(10))
        self.assertEqual(self.core.get_proposal(self.pid)["voter_count"], 1)

    def test_vote_rules(self):
        self.send_reverts("does not exist", self.core, "vote", 999, True, sender=A(10))
        self.send_reverts("closed", self.core, "vote", self.pid, True, sender=A(10), at=T0 + HOUR + 1)
        ai(REVISE)
        needs = self.submit(self.core, at=T0)
        self.send_reverts("not open", self.core, "vote", needs, True, sender=A(10), at=T0)

    def test_vote_at_the_last_second_is_allowed(self):
        closes = self.core.get_proposal(self.pid)["voting_closes_at"]
        self.env.send(self.core, "vote", self.pid, True, sender=A(10), at=closes)
        self.assertEqual(self.core.get_proposal(self.pid)["votes_yes"], 1)

    def test_get_vote_view(self):
        self.cast(self.core, self.pid, False, [10], at=T0 + 50)
        self.assertEqual(self.core.get_vote(self.pid, A(10)),
                         {"voted": True, "support": False, "weight": 1, "cast_at": T0 + 50})
        self.assertEqual(self.core.get_vote(self.pid, A(11))["voted"], False)
        self.assertEqual(self.core.get_vote(999, A(10))["voted"], False)

    def test_voter_whitelist_gates_voting_and_stays_live(self):
        self.core.use_whitelist_for_voting = True
        self.send_reverts("whitelist", self.core, "vote", self.pid, True, sender=A(10))
        self.core.voter_whitelist[hexa(10)] = True
        self.cast(self.core, self.pid, True, [10])
        self.core.voter_whitelist[hexa(10)] = False            # membership is live by design
        self.send_reverts("whitelist", self.core, "vote", self.pid, True, sender=A(11))


class FinalizeAndQuorum(GovTestCase):
    """Quorum is a count of distinct voters in every mode; approval is weighted."""

    def setUp(self):
        super().setUp()
        self.core = self.new_core(fake_admin=True)

    def outcome(self, pid):
        p = self.core.get_proposal(pid)
        return p["status"], p["failure_reason"]

    def test_finalize_needs_a_closed_pending_proposal(self):
        pid = self.submit(self.core)
        self.send_reverts("not yet closed", self.core, "finalize_decision", pid, sender=A(9), at=T0 + 10)
        self.send_reverts("does not exist", self.core, "finalize_decision", 77, sender=A(9))
        self.finalize(self.core, pid)
        self.send_reverts("not in a finalizable state", self.core, "finalize_decision", pid, sender=A(9))

    def test_equal_mode_quorum_counts_voters(self):
        pid = self.submit(self.core)
        self.cast(self.core, pid, True, [10, 11])
        self.finalize(self.core, pid)
        self.assertEqual(self.outcome(pid), ("failed", "quorum_not_met"))
        self.assertTrue(any("(2 votes, required 3)" in d for d in event_details(self.core, CORE.EVENT_PROPOSAL_FAILED)))

    def test_passing_proposal(self):
        pid = self.submit(self.core)
        self.cast(self.core, pid, True, [10, 11, 12])
        self.finalize(self.core, pid)
        self.assertEqual(self.outcome(pid), ("passed", ""))
        self.assertTrue(any("100% approval" in d for d in event_details(self.core, CORE.EVENT_PROPOSAL_PASSED)))

    def test_threshold_boundary_at_60_percent(self):
        ok, no = self.submit(self.core), self.submit(self.core)
        self.cast(self.core, ok, True, [10, 11, 12]); self.cast(self.core, ok, False, [13, 14])     # 60%
        self.cast(self.core, no, True, [10, 11]); self.cast(self.core, no, False, [12, 13, 14])     # 40%
        self.finalize(self.core, ok); self.finalize(self.core, no)
        self.assertEqual(self.outcome(ok), ("passed", ""))
        self.assertEqual(self.outcome(no), ("failed", "threshold_not_met"))
        self.assertTrue(any("40% < 60%" in d for d in event_details(self.core, CORE.EVENT_PROPOSAL_FAILED)))

    def test_no_votes_fails_quorum_without_dividing_by_zero(self):
        pid = self.submit(self.core)
        self.finalize(self.core, pid)
        self.assertEqual(self.outcome(pid), ("failed", "quorum_not_met"))

    def test_constitution_proposal_awaits_admin_confirmation(self):
        pid = self.submit(self.core, ptype="constitution", amend="NEW")
        self.cast(self.core, pid, True, [10, 11, 12])
        self.finalize(self.core, pid)
        self.assertEqual(self.outcome(pid)[0], "pending_constitution_confirm")
        self.assertEqual(self.core.constitution, "We govern fairly. Rule 1: no harm.")

    def test_finalize_is_permissionless_and_final(self):
        pid = self.submit(self.core)
        self.cast(self.core, pid, True, [10, 11, 12])
        self.finalize(self.core, pid)
        self.send_reverts("not open", self.core, "vote", pid, True, sender=A(20))


class WeightedQuorum(GovTestCase):
    """In token-weighted mode quorum is still N distinct voters (the
    same min_quorum as equal mode); the approval percentage is by weight."""

    def setUp(self):
        super().setUp()
        self.core = self.new_core(eligibility="open", weight="token_weighted", fake_admin=True)
        self.tok = A(60)
        self.core.voting_token = self.tok

    def open_proposal(self, balances):
        evm_token(self.tok, balances)
        return self.submit(self.core)

    def test_two_whales_do_not_satisfy_a_quorum_of_three(self):
        pid = self.open_proposal({A(10): 1000 * ONE, A(11): 1000 * ONE})
        self.cast(self.core, pid, True, [10, 11])
        p = self.core.get_proposal(pid)
        self.assertEqual((p["voter_count"], p["votes_yes"]), (2, 2000 * ONE))
        self.finalize(self.core, pid)
        self.assertEqual(self.core.get_proposal(pid)["failure_reason"], "quorum_not_met")

    def test_three_small_holders_satisfy_quorum(self):
        pid = self.open_proposal({A(10): 1, A(11): 1, A(12): 1})
        self.cast(self.core, pid, True, [10, 11, 12])
        self.finalize(self.core, pid)
        self.assertEqual(self.core.get_proposal(pid)["status"], "passed")

    def test_one_whale_cannot_meet_quorum_alone_however_large(self):
        pid = self.open_proposal({A(10): 10 ** 30})
        self.cast(self.core, pid, True, [10])
        self.finalize(self.core, pid)
        self.assertEqual(self.core.get_proposal(pid)["failure_reason"], "quorum_not_met")

    def test_approval_percentage_is_weighted(self):
        pid = self.open_proposal({A(10): 1000, A(11): 1, A(12): 1, A(13): 1})
        self.cast(self.core, pid, False, [10])                     # whale votes no
        self.cast(self.core, pid, True, [11, 12, 13])              # 3 small yes: 4 voters, 3/1003 weight
        self.finalize(self.core, pid)
        self.assertEqual(self.core.get_proposal(pid)["failure_reason"], "threshold_not_met")

    def test_weighted_yes_majority_by_weight_passes(self):
        pid = self.open_proposal({A(10): 700, A(11): 100, A(12): 100, A(13): 100})
        self.cast(self.core, pid, True, [10]); self.cast(self.core, pid, False, [11, 12, 13])
        self.finalize(self.core, pid)                              # 700/1000 = 70% yes
        self.assertEqual(self.core.get_proposal(pid)["status"], "passed")

    def test_zero_balance_cannot_vote_and_does_not_count(self):
        pid = self.open_proposal({A(10): 5})
        self.send_reverts("zero", self.core, "vote", pid, True, sender=A(11))
        self.assertEqual(self.core.get_proposal(pid)["voter_count"], 0)

    def test_quorum_uses_the_snapshotted_min_quorum(self):
        pid = self.open_proposal({A(i): 1 for i in (10, 11, 12)})
        self.core.min_quorum = 10                                  # tightened after the window opened
        self.cast(self.core, pid, True, [10, 11, 12])
        self.finalize(self.core, pid)
        self.assertEqual(self.core.get_proposal(pid)["status"], "passed")


class RuleSnapshots(GovTestCase):
    """The rules a proposal is judged by are frozen when its voting window
    opens: quorum, threshold, weight mode, eligibility mode, token, minimum
    tokens and token kind."""

    def setUp(self):
        super().setUp()
        self.core, self.admin = self.new_pair(3)

    def test_snapshot_values_are_exposed(self):
        self.core.eligibility_mode = "erc20"
        self.core.min_tokens_to_vote = 7
        self.core.voting_token = A(60)
        evm_token(A(60), {PROPOSER: 100})
        p = self.core.get_proposal(self.submit(self.core))
        self.assertEqual((p["voting_eligibility_mode"], p["min_tokens_to_vote"], p["voting_token"].lower()),
                         ("erc20", 7, A(60).as_hex))
        self.assertEqual((p["quorum_required"], p["approval_threshold_percent"], p["voting_weight_mode"]),
                         (3, 60, "equal"))

    def test_token_swap_mid_vote_does_not_mix_units(self):
        self.core.eligibility_mode = "open"
        self.core.voting_weight_mode = "token_weighted"
        evm_token(A(60), {A(10): 5, A(11): 5})                     # original token
        evm_token(A(61), {A(12): 999})                             # token admins switch to mid-vote
        self.core.voting_token = A(60)
        pid = self.submit(self.core, dur=5 * DAY)
        self.cast(self.core, pid, True, [10])
        aid = self.authorize_and_execute(self.admin, "propose_set_token_rules", hexa(61), 0, 0, "erc20")
        self.apply(self.core, aid)
        self.assertEqual(self.core.get_config()["voting_token"].lower(), A(61).as_hex)      # live config changed
        self.cast(self.core, pid, True, [11])                       # still weighed on the ORIGINAL token
        self.assertEqual(self.core.get_vote(pid, A(11))["weight"], 5)
        self.send_reverts("zero", self.core, "vote", pid, True, sender=A(12), at=self.env.now)   # new-token whale: no weight
        self.assertEqual(self.core.get_proposal(pid)["votes_yes"], 10)
        later = self.submit(self.core)                              # new proposals use the new token
        self.cast(self.core, later, True, [12])
        self.assertEqual(self.core.get_vote(later, A(12))["weight"], 999)

    def test_loosening_eligibility_mid_vote_does_not_admit_new_voters(self):
        self.core.eligibility_mode = "erc20"
        self.core.min_tokens_to_vote = 10
        self.core.voting_token = A(60)
        evm_token(A(60), {A(10): 50})
        pid = self.submit(self.core, sender=A(10))
        self.core.eligibility_mode = "open"                         # admin loosens the rules
        self.send_reverts("insufficient tokens", self.core, "vote", pid, True, sender=A(11))
        self.cast(self.core, pid, True, [10])

    def test_tightening_eligibility_mid_vote_does_not_lock_voters_out(self):
        pid = self.submit(self.core)                                # opened under "open"
        self.core.eligibility_mode = "erc20"
        self.core.min_tokens_to_vote = 10 ** 9
        self.core.voting_token = A(60)
        self.cast(self.core, pid, True, [10])                       # no tokens, still allowed
        self.assertTrue(self.core.get_vote(pid, A(10))["voted"])

    def test_min_tokens_change_mid_vote_is_ignored(self):
        self.core.eligibility_mode = "erc20"
        self.core.voting_token = A(60)
        self.core.min_tokens_to_vote = 10
        evm_token(A(60), {A(10): 15})
        pid = self.submit(self.core, sender=A(10))
        self.core.min_tokens_to_vote = 100
        self.cast(self.core, pid, True, [10])
        self.assertTrue(self.core.get_vote(pid, A(10))["voted"])

    def test_weight_mode_flip_mid_vote_is_ignored(self):
        self.core.voting_weight_mode = "token_weighted"
        self.core.voting_token = A(60)
        evm_token(A(60), {A(10): 42})
        pid = self.submit(self.core)
        self.core.voting_weight_mode = "equal"
        self.cast(self.core, pid, True, [10])
        self.assertEqual(self.core.get_vote(pid, A(10))["weight"], 42)
        eq = self.submit(self.core)
        self.cast(self.core, eq, True, [10])
        self.assertEqual(self.core.get_vote(eq, A(10))["weight"], 1)

    def test_custom_mode_uses_the_frozen_interface_kind(self):
        self.core.eligibility_mode = "custom"
        self.core.custom_token_interface_kind = "erc20"
        self.core.voting_token = A(60)
        self.core.min_tokens_to_vote = 1
        evm_token(A(60), {A(10): 3})
        pid = self.submit(self.core, sender=A(10))
        self.core.custom_token_interface_kind = ""                  # would fail closed if it were read live
        self.cast(self.core, pid, True, [10])
        self.assertTrue(self.core.get_vote(pid, A(10))["voted"])

    def test_nft_mode_is_frozen_too(self):
        self.core.eligibility_mode = "nft"
        self.core.voting_token = A(60)
        evm_token(A(60), {A(10): 1})
        pid = self.submit(self.core, sender=A(10))
        self.core.eligibility_mode = "open"
        self.send_reverts("governance nft", self.core, "vote", pid, True, sender=A(11))
        self.cast(self.core, pid, True, [10])

    def test_rules_are_refrozen_when_a_resubmission_reopens_voting(self):
        ai(REVISE)
        pid = self.submit(self.core)
        self.assertEqual(self.core.get_proposal(pid)["status"], "needs_revision")
        self.core.min_quorum = 5
        self.core.eligibility_mode = "erc20"
        self.core.voting_token = A(60)
        self.core.min_tokens_to_vote = 3
        evm_token(A(60), {PROPOSER: 10})
        ai(ACCEPT)
        self.env.send(self.core, "resubmit_proposal", pid, "better", sender=PROPOSER)
        p = self.core.get_proposal(pid)
        self.assertEqual((p["status"], p["quorum_required"], p["voting_eligibility_mode"], p["min_tokens_to_vote"]),
                         ("pending", 5, "erc20", 3))

    def test_eligibility_reads_the_frozen_token_not_the_live_one(self):
        self.core.eligibility_mode = "erc20"
        self.core.min_tokens_to_vote = 1
        self.core.voting_token = A(60)
        evm_token(A(60), {A(10): 5, PROPOSER: 5})                  # original token: voter 10 holds it
        evm_token(A(61), {A(11): 5})                               # token admins switch to: voter 11 holds it
        pid = self.submit(self.core)
        self.core.voting_token = A(61)
        self.send_reverts("insufficient tokens", self.core, "vote", pid, True, sender=A(11))
        self.cast(self.core, pid, True, [10])
        self.assertTrue(self.core.get_vote(pid, A(10))["voted"])

    def test_reopening_refreezes_the_token_and_the_token_kind(self):
        self.core.eligibility_mode = "custom"
        self.core.custom_token_interface_kind = ""                 # unset: custom mode fails closed at this point
        self.core.min_tokens_to_propose = 0
        ai(REVISE)
        pid = self.submit(self.core)
        self.assertEqual(self.core.get_proposal(pid)["status"], "needs_revision")
        self.core.custom_token_interface_kind = "erc20"            # configured while the proposal waited
        self.core.voting_token = A(60)
        self.core.min_tokens_to_vote = 1
        evm_token(A(60), {A(10): 3})
        ai(ACCEPT)
        self.env.send(self.core, "resubmit_proposal", pid, "better", sender=PROPOSER)
        self.assertEqual(self.core.get_proposal(pid)["voting_token"].lower(), A(60).as_hex)
        self.cast(self.core, pid, True, [10])                      # only works if kind and token were re-frozen
        self.assertTrue(self.core.get_vote(pid, A(10))["voted"])

    def test_rules_are_refrozen_when_a_dispute_reopens_voting(self):
        ai(REJECT)
        pid = self.submit(self.core)
        self.core.min_quorum = 6
        ai(DISPUTE_ACCEPT)
        self.env.send(self.core, "raise_dispute", pid, "please reconsider", sender=PROPOSER)
        p = self.core.get_proposal(pid)
        self.assertEqual((p["status"], p["quorum_required"]), ("pending", 6))

    def test_parameter_changes_apply_only_to_later_proposals(self):
        old = self.submit(self.core, dur=5 * DAY)
        aid = self.authorize_and_execute(self.admin, "propose_set_voting_parameters", 5, 90, HOUR, 10 * DAY)
        self.apply(self.core, aid)
        new = self.submit(self.core, dur=5 * DAY)
        self.cast(self.core, old, True, [10, 11, 12]); self.cast(self.core, old, False, [13])
        self.finalize(self.core, old)                               # 3 voters/4, 75%: passes the OLD 3 / 60%
        self.assertEqual(self.core.get_proposal(old)["status"], "passed")
        self.cast(self.core, new, True, [10, 11, 12], at=self.env.now)
        self.finalize(self.core, new)                               # the NEW rules need 5 voters / 90%
        self.assertEqual(self.core.get_proposal(new)["failure_reason"], "quorum_not_met")


class CancelRules(GovTestCase):
    def setUp(self):
        super().setUp()
        self.core = self.new_core(fake_admin=True)

    def test_proposer_can_cancel_while_voting_is_open(self):
        pid = self.submit(self.core)
        self.env.send(self.core, "cancel_proposal", pid, sender=PROPOSER, at=T0 + 10)
        self.assertEqual(self.core.get_proposal(pid)["status"], "cancelled")
        self.send_reverts("cancelled", self.core, "cancel_proposal", pid, sender=PROPOSER)

    def test_cancel_is_refused_after_the_window_closes(self):
        pid = self.submit(self.core)
        self.cast(self.core, pid, False, [10, 11, 12])
        self.send_reverts("voting has closed", self.core, "cancel_proposal", pid, sender=PROPOSER, at=T0 + HOUR + 1)
        self.assertEqual(self.core.get_proposal(pid)["status"], "pending")

    def test_cancel_at_the_last_second_is_allowed(self):
        pid = self.submit(self.core)
        self.env.send(self.core, "cancel_proposal", pid, sender=PROPOSER, at=T0 + HOUR)
        self.assertEqual(self.core.get_proposal(pid)["status"], "cancelled")

    def test_only_the_proposer_can_cancel_and_the_proposal_must_exist(self):
        pid = self.submit(self.core)
        self.send_reverts("only the original proposer", self.core, "cancel_proposal", pid, sender=A(9))
        self.send_reverts("does not exist", self.core, "cancel_proposal", 99, sender=PROPOSER)

    def test_needs_revision_proposals_stay_cancellable(self):
        ai(REVISE)
        pid = self.submit(self.core)
        self.env.send(self.core, "cancel_proposal", pid, sender=PROPOSER, at=T0 + 30 * DAY)
        self.assertEqual(self.core.get_proposal(pid)["status"], "cancelled")

    def test_finished_proposals_cannot_be_cancelled(self):
        pid = self.submit(self.core)
        self.cast(self.core, pid, True, [10, 11, 12])
        self.finalize(self.core, pid)
        self.send_reverts("only 'pending' or 'needs_revision'", self.core, "cancel_proposal", pid, sender=PROPOSER)


if __name__ == "__main__":
    unittest.main()
