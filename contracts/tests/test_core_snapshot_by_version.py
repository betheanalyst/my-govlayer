"""A proposal records the constitution VERSION it was reviewed under, not a
copy of the text. get_proposal still returns the exact text (same key, same
content) read from the append-only constitution_history; list_proposals returns
the two heavy text fields empty so a list page does not scale with constitution
length."""
import json
import unittest

from helpers import (A, CORE, DAY, DEPLOYER, GENESIS, HOUR, PROPOSER, GovTestCase, G, ai, ACCEPT, REJECT, REVISE,
                     DISPUTE_REJECT, DISPUTE_ACCEPT)

BIG = CORE.MAX_CONSTITUTION_LENGTH
NEW_RULES = "BRAND NEW RULES: article 1."


class VersionReference(GovTestCase):
    def setUp(self):
        super().setUp()
        self.core, self.admin = self.new_pair(3)

    def adopt(self, text):
        """Pass an amendment through the whole flow so the constitution moves to a new version."""
        ai(ACCEPT)                                                  # the amendment itself must pass the AI review
        pid = self.submit(self.core, title="Amend", ptype="constitution", amend=text, dur=5 * DAY)
        self.cast(self.core, pid, True, [10, 11, 12])
        self.finalize(self.core, pid)
        aid = self.authorize_and_execute(self.admin, "propose_constitution_update", pid)
        self.apply(self.core, aid)
        return pid

    def test_a_proposal_stores_a_version_not_a_text_copy(self):
        core = self.new_core(fake_admin=True)
        core.constitution = "C" * BIG                               # the live text is as large as allowed
        core.constitution_history[1].text = "C" * BIG
        pid = self.submit(core)
        stored = core.proposals[str(pid)]
        self.assertFalse(hasattr(stored, "constitution_snapshot"))
        self.assertEqual(int(stored.constitution_version), 1)
        text_held = sum(len(v) for v in vars(stored).values() if isinstance(v, str))
        self.assertLess(text_held, 1000, "a standard proposal must not carry constitution text")

    def test_get_proposal_returns_the_exact_text_of_the_version_in_force_at_submission(self):
        old = self.submit(self.core, dur=5 * DAY)
        self.adopt(NEW_RULES)
        new = self.submit(self.core, dur=5 * DAY)
        p_old, p_new = self.core.get_proposal(old), self.core.get_proposal(new)
        self.assertEqual((p_old["constitution_version"], p_old["constitution_snapshot"]), (1, GENESIS))
        self.assertEqual((p_new["constitution_version"], p_new["constitution_snapshot"]), (2, NEW_RULES))
        self.assertEqual(self.core.constitution, NEW_RULES)

    def test_the_text_equals_what_constitution_history_publishes(self):
        pid = self.submit(self.core)
        history = {v["version"]: v["text"] for v in self.core.get_constitution_history(0, 10)}
        p = self.core.get_proposal(pid)
        self.assertEqual(p["constitution_snapshot"], history[p["constitution_version"]])

    def test_ai_re_review_uses_the_text_of_the_proposals_own_version_not_the_live_one(self):
        ai(REVISE)
        needs = self.submit(self.core, dur=5 * DAY)
        ai(REJECT)
        rejected = self.submit(self.core, dur=5 * DAY)
        ai(ACCEPT)
        self.adopt(NEW_RULES)                                       # the constitution moves on
        G.PROMPTS.clear()
        self.env.send(self.core, "resubmit_proposal", needs, "better", sender=PROPOSER)
        self.assertIn(GENESIS, G.PROMPTS[-1])
        self.assertNotIn(NEW_RULES, G.PROMPTS[-1])
        G.PROMPTS.clear()
        ai(DISPUTE_REJECT)
        self.env.send(self.core, "raise_dispute", rejected, "please reconsider", sender=PROPOSER)
        self.assertIn(GENESIS, G.PROMPTS[-1])
        self.assertNotIn(NEW_RULES, G.PROMPTS[-1])

    def test_a_reopened_proposal_keeps_its_original_version(self):
        ai(REVISE)
        pid = self.submit(self.core, dur=5 * DAY)
        ai(ACCEPT)
        self.adopt(NEW_RULES)
        self.env.send(self.core, "resubmit_proposal", pid, "better", sender=PROPOSER)
        p = self.core.get_proposal(pid)
        self.assertEqual((p["status"], p["constitution_version"], p["constitution_snapshot"]), ("pending", 1, GENESIS))

    def test_a_dispute_reopen_keeps_its_original_version(self):
        ai(REJECT)
        pid = self.submit(self.core, dur=5 * DAY)
        self.adopt(NEW_RULES)
        ai(DISPUTE_ACCEPT)
        self.env.send(self.core, "raise_dispute", pid, "fair", sender=PROPOSER)
        p = self.core.get_proposal(pid)
        self.assertEqual((p["status"], p["constitution_version"]), ("pending", 1))

    def test_unknown_version_reads_as_empty_not_an_error(self):
        self.assertEqual(self.core._constitution_text_at(999), "")


class StaleAmendmentUsesVersions(GovTestCase):
    """The stale-amendment check compares versions: exact, and O(1) instead of a 20k-char string compare."""

    def test_an_amendment_drafted_before_any_adoption_is_refused_afterwards_even_if_the_text_is_identical(self):
        core, admin = self.new_pair(3)
        first = self.submit(core, title="A", ptype="constitution", amend=GENESIS, dur=5 * DAY)    # re-adopts identical text
        second = self.submit(core, title="B", ptype="constitution", amend="SOMETHING ELSE", dur=5 * DAY)
        for pid in (first, second):
            self.cast(core, pid, True, [10, 11, 12])
        self.finalize(core, first)
        self.finalize(core, second)
        a1 = self.authorize_and_execute(admin, "propose_constitution_update", first)
        a2 = self.authorize_and_execute(admin, "propose_constitution_update", second)
        self.apply(core, a1)
        self.assertEqual((core.get_config()["constitution_version"], core.constitution), (2, GENESIS))
        self.apply(core, a2)                                      # drafted against version 1; the constitution has since changed
        self.assertTrue(core.rejected_admin_action_ids.get(a2))
        self.assertEqual(core.constitution, GENESIS)

    def test_a_current_version_amendment_still_applies(self):
        core, admin = self.new_pair(3)
        pid = self.submit(core, ptype="constitution", amend=NEW_RULES, dur=5 * DAY)
        self.cast(core, pid, True, [10, 11, 12])
        self.finalize(core, pid)
        self.apply(core, self.authorize_and_execute(admin, "propose_constitution_update", pid))
        self.assertEqual((core.constitution, core.get_proposal(pid)["status"]), (NEW_RULES, "passed"))


class LightListView(GovTestCase):
    def build(self, constitution, n=5, amendment="Z" * 50):
        G._Msg.sender_address = DEPLOYER
        core = CORE.GovLayerCore(constitution, "open", 0, 0, "equal")
        core.max_proposals_per_window = 1000
        G.NATIVE[__import__("helpers").ADMIN_ADDR.as_hex] = __import__("helpers").FakeAdmin()
        self.env.send(core, "set_admin_contract_address", __import__("helpers").ADMIN_ADDR.as_hex, sender=DEPLOYER)
        for i in range(n):
            self.submit(core, ptype="constitution", amend=amendment, sender=A(2 + i % 9), at=self.env.now + i)
        return core

    def test_list_items_omit_the_two_heavy_text_fields_but_keep_every_key(self):
        core = self.build(GENESIS, n=2, amendment="AMENDMENT TEXT")
        item, full = core.list_proposals(0, 5)[0], core.get_proposal(1)
        self.assertEqual(set(item), set(full), "the list view must expose exactly the same keys")
        self.assertEqual((item["constitution_snapshot"], item["proposed_constitution"]), ("", ""))
        self.assertEqual((full["constitution_snapshot"], full["proposed_constitution"]), (GENESIS, "AMENDMENT TEXT"))
        self.assertEqual(item["constitution_version"], full["constitution_version"])
        for key in set(full) - {"constitution_snapshot", "proposed_constitution"}:
            self.assertEqual(item[key], full[key], key)

    def test_a_list_page_does_not_grow_with_constitution_length(self):
        small = len(json.dumps(self.build("short constitution", n=40, amendment="x" * 10).list_proposals(0, 40)))
        self.env = type(self.env)()
        big = len(json.dumps(self.build("C" * BIG, n=40, amendment="A" * BIG).list_proposals(0, 40)))
        self.assertLess(abs(big - small), 2000, (small, big))
        self.assertLess(big, 60_000, "40 maximum-size proposals must still list in well under 60 KB")

    def test_a_hundred_maximum_size_proposals_list_in_a_small_response(self):
        core = self.build("C" * BIG, n=100, amendment="A" * BIG)
        page = json.dumps(core.list_proposals(0, 10 ** 6))
        self.assertEqual(len(core.list_proposals(0, 10 ** 6)), CORE.MAX_PAGE_LIMIT)
        self.assertLess(len(page), 200_000, f"{len(page):,} bytes (it was ~4 MB when every item carried both texts)")
        self.assertGreater(len(json.dumps(core.get_proposal(1))), 2 * BIG, "a single read still returns both texts in full")

    def test_pagination_offsets_are_unchanged(self):
        core = self.build(GENESIS, n=7)
        self.assertEqual([p["proposal_id"] for p in core.list_proposals(2, 3)], [3, 4, 5])
        self.assertEqual(core.list_proposals(50, 10), [])


if __name__ == "__main__":
    unittest.main()
