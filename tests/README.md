# GovLayer contract tests

Standard-library only: no `pip install`, no network, no GenLayer node.

```bash
cd contracts
python -m unittest discover -s tests -v          # 251 tests, ~1 s
python tests/coverage_report.py --show-missing   # line coverage of both contracts
python tests/tools/mutation_check.py             # re-break every fix; the suite must fail
python tests/tools/ast_compare.py old.py new.py  # prove two versions differ only in comments/docstrings
```

`pytest` also works (`pytest tests`), since these are plain `unittest` classes.

## What is tested

| File | Covers |
|---|---|
| `test_core_admin_pull.py` | Wiring validation; applying **every** Admin action type through the **real** Admin; malformed payloads; replay; constitution flow; ordering and expiry; **per-address whitelist ordering, including all 24 pull orders of four actions** |
| `test_core_voting.py` | Voting, finalize, voter-count quorum (equal and token-weighted), per-proposal rule snapshots, cancellation |
| `test_core_snapshot_by_version.py` | **Constitution snapshot by version reference**: exact text still returned, AI re-review and stale-amendment checks use the proposal's own version, list pages stay small regardless of constitution length |
| `test_core_ai.py` | Submission audit, resubmission (amendment text), 3-stage disputes, prompt hardening, unusable-AI-output reverts |
| `test_core_proposals.py` | Constructor, submission validation, proposing eligibility, rate limit, every view and pagination clamp |
| `test_core_tokens.py` | Balance resolution chain (`balanceOf` → `balance_of` → native), every eligibility mode |
| `test_admin.py` | Bootstrap, membership, threshold table, approval windows, timelock, **validity window**, revalidation, epochs, pause, every `propose_*` validator |
| `test_defensive.py` | Corrupted storage fails safe, bad clock, failed consensus rounds, pagination edge cases |
| `test_surface_freeze.py` | **Frontend-compatibility guard**: public methods, parameters, view keys and event-text formats can never be removed or renamed, and any *addition* to the public surface must be listed in the test on purpose; constants duplicated across the two contracts stay equal |
| `test_examples.py` | `examples/sample_gl_token.py` and `examples/BalanceProbe.py` |

Core is mostly tested wired to the real `GovLayerAdmin`, so ordering and expiry
tests use genuine multisig/timelock timestamps rather than mocks. `FakeAdmin`
(in `helpers.py`) is used only where a hand-crafted or malformed action record
is needed.

## How the runtime is simulated (and its limits)

`tests/support/genlayer/__init__.py` is a small in-process stand-in for the
GenVM `genlayer` module. It models storage as Python objects, `TreeMap` /
`DynArray`, the transaction clock and sender, `gl.trace`, `gl.vm.UserError`,
**whole-transaction rollback on any exception**, cross-contract views between
in-process contracts, dict-backed EVM interfaces, and a leader/validator round
for `gl.vm.run_nondet_unsafe` driven by a scripted fake LLM.

It does **not** model real consensus or validator disagreement, gas, GenVM
storage limits, real EVM calls, the SDK's type coercion, or real LLM behaviour.
These unit tests prove the **logic**; they are not a substitute for running the
contracts on a GenLayer network. See "Pre-launch verification" in `../README.md`.

## Quality gates

* **Coverage** (`coverage_report.py`): 99.8% of executable lines (2,205 of 2,209). The few
  uncovered lines are unreachable safety nets (e.g. an "unknown action type"
  fallback behind an earlier guard). CI fails below 97%.
* **Mutation check** (`tools/mutation_check.py`): 61 mutants, each re-introducing
  a fixed defect (the whitelist-ordering exploit, a list view that returns the
  heavy text again, off-by-one expiry, live token read instead of the snapshot, threshold floor
  back to 50, …). All must be killed. If you
  fix a new defect, add a mutant for it. The script refuses stale mutants.
* **Frontend baseline** (`abi_baseline.json`): recorded from the original V2
  contracts the deployed frontend was built against. Adding methods/keys is fine.
  If you *deliberately* change the frontend-facing surface, update the frontend
  in the same change and regenerate with
  `python tests/tools/make_abi_snapshot.py <folder-with-old-contracts>`.

## Adding a test

Subclass `GovTestCase` (in `helpers.py`). Useful pieces:

```python
core, admin = self.new_pair(3)                 # real Admin (3 admins) wired to a real Core
pid = self.submit(core)                        # AI accepts by default; ai(REJECT) etc. to change
self.cast(core, pid, True, [10, 11, 12])       # three voters
self.finalize(core, pid)
aid = self.authorize_and_execute(admin, "propose_set_voting_parameters", 4, 70, 3600, 864000)
self.apply(core, aid)                          # anyone pulls it into Core
self.send_reverts("already applied", core, "apply_admin_action", aid, sender=A(9))
self.env.advance(3600)                         # move the clock
```
