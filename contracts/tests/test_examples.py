"""The two example contracts: SampleGovToken and BalanceProbe."""
import json
import unittest

from helpers import A, GovTestCase, G, load_module

TOKEN = load_module("examples/sample_gl_token.py", "sample_token")
PROBE = load_module("examples/BalanceProbe.py", "balance_probe")
OWNER, ALICE, BOB = A(1), A(10), A(11)


class SampleToken(GovTestCase):
    def setUp(self):
        super().setUp()
        G._Msg.sender_address = OWNER
        self.tok = TOKEN.SampleGovToken(1000)

    def test_initial_state(self):
        self.assertEqual((self.tok.total_supply(), self.tok.balance_of(OWNER.as_hex)), (1000, 1000))

    def test_balance_of_accepts_str_or_address(self):
        self.env.send(self.tok, "transfer", ALICE.as_hex, 250, sender=OWNER)
        self.assertEqual((self.tok.balance_of(ALICE.as_hex), self.tok.balance_of(ALICE)), (250, 250))
        self.assertEqual(self.tok.balance_of(BOB.as_hex), 0)

    def test_transfer_rules(self):
        self.send_reverts("insufficient", self.tok, "transfer", ALICE.as_hex, 5, sender=BOB)
        self.send_reverts("positive", self.tok, "transfer", ALICE.as_hex, 0, sender=OWNER)
        self.env.send(self.tok, "transfer", ALICE.as_hex, 1000, sender=OWNER)
        self.assertEqual(self.tok.balance_of(OWNER.as_hex), 0)

    def test_only_the_owner_mints(self):
        self.send_reverts("only the owner", self.tok, "mint", BOB.as_hex, 5, sender=ALICE)
        self.send_reverts("positive", self.tok, "mint", BOB.as_hex, 0, sender=OWNER)
        self.env.send(self.tok, "mint", BOB.as_hex, 5, sender=OWNER)
        self.assertEqual((self.tok.balance_of(BOB.as_hex), self.tok.total_supply()), (5, 1005))

    def test_governance_core_reads_it_through_the_native_path(self):
        core = self.new_core(eligibility="erc20", weight="token_weighted", fake_admin=True)
        token_addr = A(70)
        G.NATIVE[token_addr.as_hex] = self.tok
        core.voting_token = token_addr
        core.min_tokens_to_vote = 1
        self.env.send(self.tok, "transfer", ALICE.as_hex, 40, sender=OWNER)
        self.env.send(self.tok, "transfer", A(2).as_hex, 10, sender=OWNER)       # the proposer needs tokens too
        pid = self.submit(core)
        self.cast(core, pid, True, [ALICE])
        self.assertEqual(core.get_vote(pid, ALICE)["weight"], 40)


class Probe(GovTestCase):
    def report(self, evm=None, native=None):
        probe = PROBE.BalanceProbe()
        token = A(71)
        if evm is not None:
            G.EVM[token.as_hex] = evm
        if native is not None:
            G.NATIVE[token.as_hex] = native
        self.env.send(probe, "probe", token.as_hex, ALICE.as_hex, sender=A(5))
        return json.loads(probe.get_report())

    def test_solidity_style_token(self):
        r = self.report(evm={"balanceOf": lambda o: 5})
        self.assertEqual((r["evm_balanceOf"]["ok"], r["evm_balanceOf"]["balance"]), (True, 5))
        self.assertFalse(r["native_balance_of"]["ok"])

    def test_snake_case_evm_token(self):
        r = self.report(evm={"balance_of": lambda o: 6})
        self.assertFalse(r["evm_balanceOf"]["ok"])
        self.assertEqual((r["evm_balance_of"]["ok"], r["evm_balance_of"]["balance"]), (True, 6))

    def test_genlayer_native_token(self):
        G._Msg.sender_address = OWNER
        tok = TOKEN.SampleGovToken(100)
        self.env.send(tok, "transfer", ALICE.as_hex, 30, sender=OWNER)
        r = self.report(native=tok)
        self.assertEqual((r["native_balance_of"]["ok"], r["native_balance_of"]["balance"]), (True, 30))

    def test_nothing_answering_reports_all_failures(self):
        r = self.report()
        self.assertFalse(any(v["ok"] for v in r.values()))
        self.assertEqual(set(r), {"evm_balanceOf", "evm_balance_of", "native_balance_of"})

    def test_report_is_empty_before_probing(self):
        self.assertEqual(PROBE.BalanceProbe().get_report(), "")


if __name__ == "__main__":
    unittest.main()
