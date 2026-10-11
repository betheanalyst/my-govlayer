# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *


# -----------------------------------------------------------------------------
# SampleGovToken -- a minimal GenLayer-native governance token, for testing
# GovLayer's token-gated modes (erc20 / custom / token_weighted).
#
# Why it exists: it exposes balance_of(owner), which is exactly what
#   * GovLayerCore's third balance-read step (get_contract_at) calls, and
#   * the existing frontend calls (adapters/tokenBalance: "balance_of").
# So with this token both sides work with no other configuration.
#
# The `owner` argument is normalised because the caller may pass either an
# Address (GovLayerCore) or a 0x-hex string (genlayer-js).
#
# This is a TEST token: unrestricted mint by the deployer, no allowances, no
# events. Do not use it as a production asset.
# -----------------------------------------------------------------------------

def _addr(v) -> Address:
    return v if isinstance(v, Address) else Address(str(v))


class SampleGovToken(gl.Contract):
    owner: Address
    supply: u256
    balances: TreeMap[Address, u256]

    def __init__(self, initial_supply: int) -> None:
        self.owner = gl.message.sender_address
        self.supply = u256(initial_supply)
        self.balances[gl.message.sender_address] = u256(initial_supply)

    @gl.public.view
    def balance_of(self, owner: str) -> int:
        return int(self.balances.get(_addr(owner), u256(0)))

    @gl.public.view
    def total_supply(self) -> int:
        return int(self.supply)

    @gl.public.write
    def transfer(self, to: str, amount: int) -> None:
        sender = gl.message.sender_address
        target = _addr(to)
        if amount <= 0:
            raise gl.vm.UserError("amount must be positive")
        have = int(self.balances.get(sender, u256(0)))
        if have < amount:
            raise gl.vm.UserError("insufficient balance")
        self.balances[sender] = u256(have - amount)
        self.balances[target] = u256(int(self.balances.get(target, u256(0))) + amount)

    @gl.public.write
    def mint(self, to: str, amount: int) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("only the owner can mint")
        if amount <= 0:
            raise gl.vm.UserError("amount must be positive")
        target = _addr(to)
        self.balances[target] = u256(int(self.balances.get(target, u256(0))) + amount)
        self.supply = u256(int(self.supply) + amount)
