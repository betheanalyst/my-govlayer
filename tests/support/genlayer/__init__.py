"""Minimal in-process stand-in for the GenVM `genlayer` module, just enough to
execute GovLayer's contract logic in unit tests.

What it models: contract storage as plain Python objects, `TreeMap`/`DynArray`,
`gl.message.sender_address`, a controllable transaction clock, `gl.trace`,
`gl.vm.UserError`, whole-transaction rollback on any exception (see `tx`),
`gl.get_contract_at(...).view().x()` dispatching to another in-process
contract, EVM interfaces backed by a dict, and `gl.nondet.exec_prompt` backed
by a test-supplied handler with a leader/validator round.

What it does NOT model: real consensus or validator disagreement, gas,
GenVM storage layout/limits, real EVM calls, or the SDK's type coercion.
Those need a live GenLayer network; see tests/README.md.
"""
import copy, typing
from datetime import datetime, timezone

class Address:
    def __init__(self, v):
        if isinstance(v, Address): b = v.b
        elif isinstance(v, (bytes, bytearray)): b = bytes(v)
        else:
            h = str(v); h = h[2:] if h.startswith(("0x", "0X")) else h
            b = bytes.fromhex(h)
        if len(b) != 20: raise ValueError("bad address")
        self.b = b
    @property
    def as_hex(self): return "0x" + self.b.hex()
    def __eq__(self, o): return isinstance(o, Address) and o.b == self.b
    def __hash__(self): return hash(self.b)
    def __repr__(self): return self.as_hex

u256 = u64 = u32 = int
def allow_storage(c): return c

def _default(t):
    if isinstance(t, type) and issubclass(t, (TreeMap, DynArray)): return t()
    if t is bool: return False
    if t in (int, u256): return 0
    if t is str: return ""
    if t is Address: return Address(bytes(20))
    return t()

class TreeMap(dict):
    _vt = None
    def __class_getitem__(cls, item):
        return type("TreeMap", (TreeMap,), {"_vt": item[1]})
    def get_or_insert_default(self, k):
        if k not in self: self[k] = _default(self._vt)
        return self[k]

class DynArray(list):
    _vt = None
    def __class_getitem__(cls, item):
        return type("DynArray", (DynArray,), {"_vt": item})

class _Revert(Exception): pass

class vm:
    class UserError(Exception): pass
    class Result: pass
    class Return(Result):
        def __init__(self, calldata): self.calldata = calldata
    leader_fails = False        # test hook: the leader round itself failed (validator receives a non-Return)

    @staticmethod
    def run_nondet_unsafe(leader, validator):
        if vm.leader_fails:
            if validator(object()):
                raise AssertionError("a validator must refuse a failed leader result")
            raise vm.UserError("consensus: leader failed")
        res = leader()
        if not validator(vm.Return(res)):
            raise vm.UserError("consensus: validator disagreed")
        return res

class _Public:
    @staticmethod
    def view(f): f._gl_public = "view"; return f
    @staticmethod
    def write(f): f._gl_public = "write"; return f

class _Msg: sender_address = Address(bytes(20))

# ---- test hooks ----
PROMPTS = []
PROMPT_HANDLER = {"fn": lambda task: '{"decision":"accept","reasoning":"ok","constitutional_conflicts":[]}'}
EVM = {}      # addr_hex -> {method_name: fn(owner)->int}
NATIVE = {}   # addr_hex -> object with methods

class nondet:
    @staticmethod
    def exec_prompt(task, response_format=None):
        PROMPTS.append(task)
        return PROMPT_HANDLER["fn"](task)

class _View:
    def __init__(self, target, declared=None): self._t, self._d = target, declared
    def __getattr__(self, name):
        if self._d is not None and name not in self._d: raise AttributeError(name)
        fn = self._t.get(name) if isinstance(self._t, dict) else getattr(self._t, name, None)
        if fn is None: raise Exception("call reverted / no such method: " + name)
        return fn

class evm:
    @staticmethod
    def contract_interface(cls):
        declared = {n for n in vars(cls.View) if not n.startswith("_")}
        def factory(addr):
            class P:
                def view(self_):
                    tgt = EVM.get(Address(addr).as_hex)
                    if tgt is None: raise Exception("no EVM contract at address")
                    return _View(tgt, declared)
            return P()
        return factory

def get_contract_at(addr):
    class P:
        def view(self_):
            tgt = NATIVE.get(Address(addr).as_hex)
            if tgt is None: raise Exception("no contract at address")
            return _View(tgt)
    return P()

class _Storage:
    @staticmethod
    def inmem_allocate(t): return _default(t)

class Contract:
    def __new__(cls, *a, **k):
        o = object.__new__(cls)
        for klass in reversed(cls.__mro__):
            for n, t in getattr(klass, "__annotations__", {}).items():
                o.__dict__[n] = _default(t)
        return o

TRACES = []
def _trace(*a): TRACES.append(" ".join(str(x) for x in a))

def set_time(ts):
    _GL.message_raw = {"datetime": datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")}

class _GL:
    trace = staticmethod(_trace)
    Contract = Contract
    public = _Public
    message = _Msg
    message_raw = {"datetime": "2027-01-15T00:00:00Z"}
    vm = vm
    nondet = nondet
    evm = evm
    storage = _Storage
    get_contract_at = staticmethod(get_contract_at)
gl = _GL

# tx helper for tests: deep-copy rollback on exception, like a reverted tx
def tx(contract, fn, *args, sender=None, now=None, **kw):
    if sender is not None: _Msg.sender_address = sender
    if now is not None:
        set_time(now)
    snap = copy.deepcopy(contract.__dict__)
    try:
        return fn(*args, **kw)
    except BaseException:
        contract.__dict__.clear(); contract.__dict__.update(snap)
        raise
