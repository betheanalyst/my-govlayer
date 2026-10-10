"""Token balance resolution: which read works, what happens when
none does, and how each eligibility / weight mode uses it."""
import unittest

from helpers import A, CORE, HOUR, PROPOSER, T0, GovTestCase, G
from test_core_voting import evm_token

TOK = A(61)


def native_token(balances, method="balance_of"):
    return type("NativeToken", (), {method: lambda self, owner: balances.get(owner, 0)})()


class BalanceResolution(GovTestCase):
    def read(self, core, user=A(10), nft=False):
        return int(core._read_balance(TOK, user, nft))

    def setUp(self):
        super().setUp()
        self.core = self.new_core(fake_admin=True)

    def test_solidity_style_balanceOf_is_tried_first(self):
        G.EVM[TOK.as_hex] = {"balanceOf": lambda o: 7, "balance_of": lambda o: 999}
        self.assertEqual(self.read(self.core), 7)
        self.assertEqual(self.read(self.core, nft=True), 7)

    def test_snake_case_evm_fallback(self):
        G.EVM[TOK.as_hex] = {"balance_of": lambda o: 8}
        self.assertEqual(self.read(self.core), 8)

    def test_genlayer_native_fallback(self):
        G.NATIVE[TOK.as_hex] = native_token({A(10): 9})
        self.assertEqual(self.read(self.core), 9)

    def test_a_working_zero_is_a_zero_not_a_failure(self):
        G.EVM[TOK.as_hex] = {"balanceOf": lambda o: 0}
        G.NATIVE[TOK.as_hex] = native_token({A(10): 50})        # must NOT be consulted
        self.assertEqual(self.read(self.core), 0)

    def test_a_reverting_first_read_falls_through(self):
        def boom(owner): raise Exception("reverted")
        G.EVM[TOK.as_hex] = {"balanceOf": boom}
        G.NATIVE[TOK.as_hex] = native_token({A(10): 4})
        self.assertEqual(self.read(self.core), 4)

    def test_nothing_answering_raises(self):
        with self.reverts("balance read failed"):
            self.read(self.core)
        G.EVM[TOK.as_hex] = {"unrelated": lambda o: 1}
        with self.reverts("balance read failed"):
            self.read(self.core)


class EligibilityModes(GovTestCase):
    def core_with(self, eligibility, weight="equal", kind="", min_vote=0):
        core = self.new_core(eligibility=eligibility, weight=weight, fake_admin=True)
        core.voting_token = TOK
        core.custom_token_interface_kind = kind
        core.min_tokens_to_vote = min_vote
        return core

    def test_erc20_requires_the_minimum_to_vote(self):
        core = self.core_with("erc20", min_vote=10)
        evm_token(TOK, {A(10): 10, A(11): 9, PROPOSER: 100})
        pid = self.submit(core)
        self.cast(core, pid, True, [10])
        self.send_reverts("insufficient tokens", core, "vote", pid, True, sender=A(11))

    def test_unreadable_token_fails_closed_for_eligibility(self):
        core = self.core_with("erc20", min_vote=1)
        evm_token(TOK, {PROPOSER: 5})
        pid = self.submit(core)
        G.EVM.clear()
        self.send_reverts("insufficient tokens", core, "vote", pid, True, sender=A(10))

    def test_unreadable_token_reverts_a_weighted_vote_instead_of_recording_zero(self):
        core = self.core_with("open", "token_weighted")
        evm_token(TOK, {})
        pid = self.submit(core)
        G.EVM.clear()
        self.send_reverts("balance read failed", core, "vote", pid, True, sender=A(10))
        self.assertFalse(core.get_vote(pid, A(10))["voted"])

    def test_nft_needs_any_positive_balance(self):
        core = self.core_with("nft")
        evm_token(TOK, {A(10): 1, PROPOSER: 1})
        pid = self.submit(core)
        self.cast(core, pid, True, [10])
        self.send_reverts("governance nft", core, "vote", pid, True, sender=A(11))

    def test_nft_with_weighted_votes_weighs_by_holding(self):
        core = self.core_with("nft", "token_weighted")
        evm_token(TOK, {A(10): 3, PROPOSER: 1})
        pid = self.submit(core)
        self.cast(core, pid, True, [10])
        self.assertEqual(core.get_vote(pid, A(10))["weight"], 3)

    def test_custom_mode_needs_a_recognised_kind(self):
        ok = self.core_with("custom", kind="erc20", min_vote=1)
        evm_token(TOK, {A(10): 1, PROPOSER: 1})
        pid = self.submit(ok)
        self.cast(ok, pid, True, [10])
        unset = self.core_with("custom", kind="", min_vote=1)
        self.assertEqual(int(unset._get_token_balance(TOK, A(10))), 0)
        bogus = self.core_with("custom", kind="erc1155", min_vote=1)
        self.assertEqual(int(bogus._get_token_balance(TOK, A(10))), 0)

    def test_zero_token_address_means_zero_balance(self):
        core = self.core_with("erc20", min_vote=1)
        core.voting_token = CORE.Address("0x" + "00" * 20)
        self.assertEqual(int(core._get_token_balance(core.voting_token, A(10))), 0)

    def test_open_equal_mode_never_reads_a_token(self):
        core = self.new_core(fake_admin=True)
        pid = self.submit(core)
        self.cast(core, pid, True, [10])                        # no token configured or needed
        self.assertEqual(core.get_vote(pid, A(10))["weight"], 1)

    def test_genlayer_native_token_works_end_to_end(self):
        core = self.core_with("erc20", "token_weighted", min_vote=1)
        G.NATIVE[TOK.as_hex] = native_token({A(10): 25, PROPOSER: 1})
        pid = self.submit(core)
        self.cast(core, pid, True, [10])
        self.assertEqual(core.get_vote(pid, A(10))["weight"], 25)


if __name__ == "__main__":
    unittest.main()
