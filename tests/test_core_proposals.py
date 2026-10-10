"""Constructor, submission validation, proposing eligibility, rate limiting,
and the read-only views (pagination, history, config)."""
import unittest

from helpers import (A, CORE, DAY, DEPLOYER, GENESIS, HOUR, PROPOSER, T0, GovTestCase, event_details, hexa, G,
                     ai, ACCEPT, REVISE)
from test_core_voting import evm_token


class Constructor(GovTestCase):
    def build(self, *args):
        G._Msg.sender_address = DEPLOYER
        return CORE.GovLayerCore(*args)

    def test_genesis_state(self):
        core = self.build(GENESIS, "open", 0, 0, "equal")
        cfg = core.get_config()
        self.assertEqual((cfg["constitution_version"], cfg["min_quorum"], cfg["approval_threshold_percent"],
                          cfg["min_voting_duration"], cfg["max_voting_duration"], cfg["proposal_count"]),
                         (1, 3, 60, HOUR, 30 * DAY, 0))
        self.assertFalse(core.is_admin_contract_configured())
        self.assertEqual(core.constitution, GENESIS)
        hist = core.get_constitution_history(0, 10)
        self.assertEqual((hist[0]["version"], hist[0]["text"]), (1, GENESIS))
        self.assertEqual(core.get_governance_history(0, 10)[0]["event_type"], CORE.EVENT_CONTRACT_INITIALIZED)

    def test_rejects_bad_arguments(self):
        for args, msg in [((GENESIS, "bogus", 0, 0, "equal"), "eligibility_mode"),
                          ((GENESIS, "open", 0, 0, "bogus"), "voting_weight_mode"),
                          (("   ", "open", 0, 0, "equal"), "empty"),
                          (("g" * (CORE.MAX_CONSTITUTION_LENGTH + 1), "open", 0, 0, "equal"), "exceeds")]:
            with self.reverts(msg):
                self.build(*args)

    def test_token_modes_are_accepted_at_genesis(self):
        for mode in ("erc20", "nft", "custom"):
            core = self.build(GENESIS, mode, 5, 10, "token_weighted")
            cfg = core.get_config()
            self.assertEqual((cfg["eligibility_mode"], cfg["min_tokens_to_vote"], cfg["min_tokens_to_propose"]), (mode, 5, 10))


class SubmissionValidation(GovTestCase):
    def setUp(self):
        super().setUp()
        self.core = self.new_core(fake_admin=True)

    def bad(self, msg, title="t", desc="d", dur=HOUR, ptype="standard", amend=""):
        self.send_reverts(msg, self.core, "submit_proposal", title, desc, dur, ptype, amend, sender=PROPOSER)
        self.assertEqual(self.core.get_config()["proposal_count"], 0)

    def test_field_rules(self):
        self.bad("title cannot be empty", title="  ")
        self.bad("description cannot be empty", desc="")
        self.bad("too long", title="x" * (CORE.TITLE_MAX_LENGTH + 1))
        self.bad("too long", desc="x" * (CORE.DESCRIPTION_MAX_LENGTH + 1))
        self.bad("cannot be zero", dur=0)
        self.bad("voting_duration must be between", dur=HOUR - 1)
        self.bad("voting_duration must be between", dur=30 * DAY + 1)
        self.bad("invalid proposal_type", ptype="other")
        self.bad("cannot be empty for constitution", ptype="constitution", amend=" ")

    def test_boundaries_are_inclusive(self):
        self.assertEqual(self.submit(self.core, title="x" * CORE.TITLE_MAX_LENGTH, desc="y" * CORE.DESCRIPTION_MAX_LENGTH), 1)
        self.assertEqual(self.submit(self.core, dur=HOUR), 2)
        self.assertEqual(self.submit(self.core, dur=30 * DAY), 3)

    def test_ids_increase_and_paused_admin_blocks_submission(self):
        self.assertEqual([self.submit(self.core) for _ in range(3)], [1, 2, 3])
        self.admin.paused = True
        self.send_reverts("paused", self.core, "submit_proposal", "t", "d", HOUR, "standard", "", sender=PROPOSER)
        self.admin.paused = False
        self.assertEqual(self.submit(self.core), 4)

    def test_unreachable_admin_fails_closed(self):
        del G.NATIVE[__import__("helpers").ADMIN_ADDR.as_hex]
        self.send_reverts("paused", self.core, "submit_proposal", "t", "d", HOUR, "standard", "", sender=PROPOSER)


class ProposingEligibility(GovTestCase):
    def test_proposer_whitelist(self):
        core = self.new_core(fake_admin=True)
        core.use_whitelist_for_proposing = True
        self.send_reverts("proposer whitelist", core, "submit_proposal", "t", "d", HOUR, "standard", "", sender=PROPOSER)
        core.proposer_whitelist[PROPOSER.as_hex] = True
        self.assertEqual(self.submit(core), 1)

    def test_erc20_minimum_to_propose(self):
        core = self.new_core(eligibility="erc20", fake_admin=True)
        core.voting_token = A(60)
        core.min_tokens_to_propose = 10
        evm_token(A(60), {PROPOSER: 9})
        self.send_reverts("insufficient tokens", core, "submit_proposal", "t", "d", HOUR, "standard", "", sender=PROPOSER)
        evm_token(A(60), {PROPOSER: 10})
        self.assertEqual(self.submit(core), 1)

    def test_nft_holder_required_to_propose(self):
        core = self.new_core(eligibility="nft", fake_admin=True)
        core.voting_token = A(60)
        evm_token(A(60), {A(3): 2})
        self.send_reverts("nft", core, "submit_proposal", "t", "d", HOUR, "standard", "", sender=PROPOSER)
        self.assertEqual(self.submit(core, sender=A(3)), 1)

    def test_proposing_uses_live_rules_not_a_snapshot(self):
        core = self.new_core(eligibility="open", fake_admin=True)
        self.assertEqual(self.submit(core), 1)
        core.eligibility_mode = "erc20"
        core.voting_token = A(60)
        core.min_tokens_to_propose = 1
        evm_token(A(60), {})
        self.send_reverts("insufficient tokens", core, "submit_proposal", "t", "d", HOUR, "standard", "", sender=PROPOSER)


class RateLimit(GovTestCase):
    def setUp(self):
        super().setUp()
        self.core = self.new_core(fake_admin=True)
        self.core.max_proposals_per_window = 2
        self.core.proposal_rate_window_secs = HOUR

    def test_limit_applies_per_proposer_within_the_window(self):
        self.submit(self.core, at=T0); self.submit(self.core, at=T0 + 10)
        self.send_reverts("rate", self.core, "submit_proposal", "t", "d", HOUR, "standard", "", sender=PROPOSER, at=T0 + 20)
        self.assertEqual(self.submit(self.core, sender=A(3), at=T0 + 20), 3)        # another address is unaffected

    def test_window_slides(self):
        self.submit(self.core, at=T0); self.submit(self.core, at=T0 + 10)
        self.assertEqual(self.submit(self.core, at=T0 + HOUR + 1), 3)

    def test_successful_reviews_consume_slots_even_when_rejected(self):
        ai('{"decision":"reject","reasoning":"no","constitutional_conflicts":[]}')
        self.submit(self.core, at=T0); self.submit(self.core, at=T0 + 1)
        self.send_reverts("rate", self.core, "submit_proposal", "t", "d", HOUR, "standard", "", sender=PROPOSER, at=T0 + 2)


class Views(GovTestCase):
    def setUp(self):
        super().setUp()
        self.core = self.new_core(fake_admin=True)

    def test_get_proposal_for_a_missing_id_is_empty(self):
        self.assertEqual(self.core.get_proposal(404), {})

    def test_list_proposals_pagination_and_clamp(self):
        for i in range(105):
            self.submit(self.core, sender=A(2 + i % 7), at=T0 + i)
        self.assertEqual([p["proposal_id"] for p in self.core.list_proposals(0, 3)], [1, 2, 3])
        self.assertEqual(len(self.core.list_proposals(100, 50)), 5)
        self.assertEqual(self.core.list_proposals(500, 10), [])
        self.assertEqual(len(self.core.list_proposals(0, 10 ** 6)), CORE.MAX_PAGE_LIMIT)
        with self.reverts("greater than 0"):
            self.core.list_proposals(0, 0)

    def test_every_paginated_view_clamps_and_rejects_zero(self):
        ai(REVISE); pid = self.submit(self.core)
        for call in (lambda n: self.core.get_governance_history(0, n),
                     lambda n: self.core.get_constitution_history(0, n),
                     lambda n: self.core.get_proposal_revisions(pid, 0, n),
                     lambda n: self.core.get_voter_whitelist(0, n),
                     lambda n: self.core.get_proposer_whitelist(0, n)):
            with self.reverts("greater than 0"):
                call(0)
            self.assertLessEqual(len(call(10 ** 6)), CORE.MAX_PAGE_LIMIT)

    def test_history_views_clamp_to_the_page_limit(self):
        for i in range(CORE.MAX_PAGE_LIMIT + 5):
            self.submit(self.core, sender=A(2 + i % 7), at=T0 + i)
        self.assertEqual(len(self.core.get_governance_history(0, 10 ** 6)), CORE.MAX_PAGE_LIMIT)
        for v in range(2, CORE.MAX_PAGE_LIMIT + 6):                 # more constitution versions than one page
            self.core.constitution_history[v] = CORE.ConstitutionVersion(
                version=v, text=f"v{v}", adopted_at=T0, adopted_via_proposal_id=0, adopted_by="genesis")
        self.core.constitution_version = CORE.MAX_PAGE_LIMIT + 5
        page = self.core.get_constitution_history(0, 10 ** 6)
        self.assertEqual((len(page), page[0]["version"], page[-1]["version"]), (CORE.MAX_PAGE_LIMIT, 1, CORE.MAX_PAGE_LIMIT))
        self.assertEqual(self.core.get_constitution_history(CORE.MAX_PAGE_LIMIT, 10 ** 6)[0]["version"], CORE.MAX_PAGE_LIMIT + 1)

    def test_governance_history_records_creation_events_in_order(self):
        self.submit(self.core); self.submit(self.core, at=T0 + 5)
        events = self.core.get_governance_history(0, 50)
        self.assertEqual(events[0]["event_type"], CORE.EVENT_CONTRACT_INITIALIZED)
        created = [e for e in events if e["event_type"] == CORE.EVENT_PROPOSAL_CREATED]
        self.assertEqual([e["proposal_id"] for e in created], [1, 2])
        self.assertEqual(self.core.get_config()["governance_history_count"], len(events))
        self.assertEqual(len(self.core.get_governance_history(1, 1)), 1)

    def test_config_exposes_the_documented_keys(self):
        self.assertEqual(set(self.core.get_config()), {
            "admin_contract_address", "approval_threshold_percent", "constitution_version", "custom_token_interface_kind",
            "dispute_cooldown_seconds", "eligibility_mode", "governance_history_count", "max_dispute_stages_count",
            "max_proposals_per_window", "max_resubmissions", "max_voting_duration", "min_quorum", "min_tokens_to_propose",
            "min_tokens_to_vote", "min_voting_duration", "proposal_count", "proposal_rate_window_secs",
            "use_whitelist_for_proposing", "use_whitelist_for_voting", "voting_token", "voting_weight_mode"})

    def test_whitelist_views_paginate(self):
        for i in range(1, 6):
            self.core.voter_whitelist[hexa(i)] = True
            self.core.voter_whitelist_list.append(hexa(i))
        self.assertEqual(len(self.core.get_voter_whitelist(0, 3)), 3)
        self.assertEqual(len(self.core.get_voter_whitelist(3, 10)), 2)
        self.assertFalse(self.core.is_proposer_whitelisted(A(1)))


if __name__ == "__main__":
    unittest.main()
