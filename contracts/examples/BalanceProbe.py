# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
from genlayer import *


# -----------------------------------------------------------------------------
# BalanceProbe -- answers, on YOUR network with YOUR token, the question
# "which balance-read spelling actually works?"
#
# probe(token, holder) tries the same three reads GovLayerCore._read_balance
# tries, in the same order, and stores a JSON report:
#   1. evm_balanceOf   -- EVM interface, real ERC20/ERC721 selector
#   2. evm_balance_of  -- EVM interface, snake_case spelling
#   3. native_balance_of -- GenVM-native call (a GenLayer contract token)
# Read the result with get_report().  Any step reporting ok=true means Core
# can read that token; if several do, Core simply uses the first.
# Nothing here mutates any token; it only records the report.
# -----------------------------------------------------------------------------

@gl.evm.contract_interface
class _EvmCamel:
    class View:
        def balanceOf(self, owner: Address, /) -> u256: ...

    class Write:
        pass


@gl.evm.contract_interface
class _EvmSnake:
    class View:
        def balance_of(self, owner: Address, /) -> u256: ...

    class Write:
        pass


class BalanceProbe(gl.Contract):
    last_report: str

    def __init__(self) -> None:
        self.last_report = ""

    @gl.public.write
    def probe(self, token: str, holder: str) -> None:
        t = Address(token)
        h = Address(holder)
        report = {}

        def attempt(label, fn):
            try:
                report[label] = {"ok": True, "balance": int(fn())}
            except Exception as e:
                report[label] = {"ok": False, "error": str(e)[:160]}

        attempt("evm_balanceOf", lambda: _EvmCamel(t).view().balanceOf(h))
        attempt("evm_balance_of", lambda: _EvmSnake(t).view().balance_of(h))
        attempt("native_balance_of", lambda: gl.get_contract_at(t).view().balance_of(h))
        self.last_report = json.dumps(report)

    @gl.public.view
    def get_report(self) -> str:
        return self.last_report
