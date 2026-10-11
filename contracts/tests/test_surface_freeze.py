"""Frontend-compatibility guard.

abi_baseline.json records the public surface the deployed frontend was built
against (recorded from the original V2 contracts). These tests fail if a later
change removes or renames anything in it. ADDING methods or view keys is fine.
The frontend also regex-parses the free-text `details` of governance events,
so those formats are pinned here too."""
import json
import os
import re
import unittest

import abi_surface
from helpers import CORE, ADMIN, HERE, GovTestCase, event_details, ACCEPT, REJECT, A, PROPOSER

BASELINE = json.load(open(os.path.join(HERE, "abi_baseline.json")))


class PublicSurface(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.now = abi_surface.collect(CORE, ADMIN)

    def check_methods(self, which):
        base, now = BASELINE[which], self.now[which]
        for name, spec in base.items():
            self.assertIn(name, now, f"{which}: public method {name} was removed or renamed")
            self.assertEqual(now[name]["kind"], spec["kind"], f"{name}: view/write kind changed")
            self.assertEqual(now[name]["params"], spec["params"], f"{name}: parameters changed")

    def test_core_methods_are_unchanged(self):
        self.check_methods("core_methods")

    def test_admin_methods_are_unchanged(self):
        self.check_methods("admin_methods")

    def test_view_keys_are_a_superset_of_the_baseline(self):
        for view, keys in BASELINE["views"].items():
            missing = set(keys) - set(self.now["views"][view])
            self.assertFalse(missing, f"{view} lost keys the frontend reads: {sorted(missing)}")

    def test_only_additive_changes_exist(self):
        """Every addition to the public surface must be listed here on purpose,
        so surface growth is always a reviewed decision (and cannot pass silently)."""
        new_core = set(self.now["core_methods"]) - set(BASELINE["core_methods"])
        self.assertEqual(new_core, {"get_vote", "resubmit_proposal_with_amendment"})
        self.assertEqual(set(self.now["admin_methods"]) - set(BASELINE["admin_methods"]), set())
        for name in new_core:
            self.assertIn(name, self.now["core_methods"])
        extra = set(self.now["views"]["core.get_proposal"]) - set(BASELINE["views"]["core.get_proposal"])
        self.assertEqual(extra, {"quorum_required", "approval_threshold_percent", "voting_weight_mode", "voter_count",
                                 "voting_eligibility_mode", "voting_token", "min_tokens_to_vote", "constitution_version"})
        for view in ("core.get_config", "admin.get_action", "admin.get_pending_actions[]", "core.get_governance_history[]",
                     "core.get_constitution_history[]", "core.get_proposal.dispute_history[]"):
            self.assertEqual(set(self.now["views"][view]) - set(BASELINE["views"][view]), set(), view)
        self.assertEqual(set(self.now["views"]["core.get_proposal_revisions[]"]) - set(BASELINE["views"]["core.get_proposal_revisions[]"]),
                         {"prior_proposed_constitution"})


class EventFormats(GovTestCase):
    """Patterns the frontend's event parser depends on."""

    def test_formats(self):
        core, admin = self.new_pair(3)
        pid = self.submit(core, ptype="constitution", amend="NEW")
        self.cast(core, pid, True, [10, 11, 12])
        self.finalize(core, pid)
        aid = self.authorize_and_execute(admin, "propose_constitution_update", pid)
        self.apply(core, aid)
        other = self.authorize_and_execute(admin, "propose_set_rate_limit_params", 500, 7200)
        self.apply(core, other)
        failing = self.submit(core)
        self.finalize(core, failing)
        e = lambda t: event_details(core, t)
        self.all_match(r"Proposal #\d+ \(type:\w+ ai:\w+ status:\w+ closes:\d+\)", e(CORE.EVENT_PROPOSAL_CREATED))
        self.all_match(r"Constitution updated to version \d+ via action ACTION-\d+, proposal #\d+",
                       e(CORE.EVENT_CONSTITUTION_UPDATE_APPLIED))
        self.all_match(r"action:ACTION-\d+\|type:\w+\|", e(CORE.EVENT_ADMIN_ACTION_APPLIED))
        self.all_match(r"Proposal #\d+ failed: quorum not met \(\d+ votes, required \d+\)", e(CORE.EVENT_PROPOSAL_FAILED))
        pending = e(CORE.EVENT_CONSTITUTION_UPDATE_PENDING_CONFIRM)
        self.assertTrue(pending, "expected a pending-confirm event")
        self.assertTrue(all(d.startswith("Proposal #") and "awaiting Admin-authorized confirmation" in d for d in pending))

    def all_match(self, pattern, items):
        """Every item matches AND there is at least one item (an empty list must not pass)."""
        self.assertTrue(items, f"no events to check against {pattern!r}")
        for d in items:
            self.assertRegex(d, "^" + pattern)

    def test_pull_rejection_format(self):
        core, admin = self.new_pair(3)
        pid = self.submit(core)                                        # standard: an amendment action for it is refused
        aid = self.authorize_and_execute(admin, "propose_constitution_update", pid)
        self.apply(core, aid)
        self.all_match(r"action_id:ACTION-\d+\|action_type:\w+\|reason:.+",
                       event_details(core, CORE.EVENT_ADMIN_ACTION_PULL_REJECTED))

    def test_status_and_failure_vocabularies_are_unchanged(self):
        self.assertEqual({CORE.STATUS_PENDING, CORE.STATUS_PASSED, CORE.STATUS_FAILED, CORE.STATUS_REJECTED,
                          CORE.STATUS_NEEDS_REVISION, CORE.STATUS_CANCELLED, CORE.STATUS_PENDING_CONSTITUTION_CONFIRM,
                          CORE.STATUS_UNDER_REVIEW},
                         {"pending", "passed", "failed", "rejected", "needs_revision", "cancelled",
                          "pending_constitution_confirm", "under_review"})
        self.assertEqual((CORE.FAILURE_REASON_QUORUM_NOT_MET, CORE.FAILURE_REASON_THRESHOLD_NOT_MET), ("quorum_not_met", "threshold_not_met"))
        self.assertEqual({ADMIN.STATUS_PENDING_APPROVALS, ADMIN.STATUS_TIMELOCKED, ADMIN.STATUS_EXECUTED, ADMIN.STATUS_EXPIRED},
                         {"pending_approvals", "timelocked", "executed", "expired"})

    def test_admin_action_type_strings_are_shared_between_contracts(self):
        for name in ("CONSTITUTION_UPDATE_PROPOSE", "SET_RATE_LIMIT_PARAMS", "SET_ELIGIBILITY_MODE", "SET_TOKEN_RULES",
                     "SET_VOTING_WEIGHT_MODE", "SET_WHITELIST_ENABLED", "UPDATE_WHITELIST", "SET_VOTING_PARAMETERS"):
            self.assertEqual(getattr(CORE, "ACTION_" + name), getattr(ADMIN, "ACTION_" + name), name)
        self.assertEqual(CORE.ADMIN_ACTION_STATUS_EXECUTED, ADMIN.STATUS_EXECUTED)


class SharedConstants(unittest.TestCase):
    """Constants duplicated across the two files must never drift apart."""

    def test_lockstep(self):
        for name in ("MIN_APPROVAL_THRESHOLD_PERCENT", "MAX_APPROVAL_THRESHOLD_PERCENT", "MIN_QUORUM_FLOOR",
                     "MIN_PROPOSALS_PER_WINDOW", "MAX_PROPOSALS_PER_WINDOW", "MIN_RATE_WINDOW_SECS", "MAX_RATE_WINDOW_SECS",
                     "MIN_VOTING_DURATION_FLOOR", "MAX_VOTING_DURATION_CEILING", "MAX_WHITELIST_BATCH_SIZE",
                     "ACTION_VALIDITY_WINDOW_SECONDS", "VALID_ELIGIBILITY_MODES", "VALID_VOTING_WEIGHT_MODES",
                     "VALID_CUSTOM_TOKEN_INTERFACE_KINDS"):
            self.assertEqual(getattr(CORE, name), getattr(ADMIN, name), f"{name} differs between Core and Admin")
        self.assertEqual(CORE.WHITELIST_TOGGLE_TARGET_VOTING, "voting")
        self.assertEqual(ADMIN.VALID_WHITELIST_TOGGLE_TARGETS, ("voting", "proposing"))
        self.assertEqual(ADMIN.VALID_WHITELIST_UPDATE_TARGETS, ("voter", "proposer"))


if __name__ == "__main__":
    unittest.main()
