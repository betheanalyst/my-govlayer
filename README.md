# GovLayer

**Rules first. Then the vote.**

GovLayer is a constitutional governance protocol built on GenLayer. A community writes a
constitution; every proposal is reviewed against it **before** anyone is asked to vote;
and everything that happens afterwards — the review, the revisions, the vote, the dispute,
the outcome — is recorded on-chain and legible in a web interface that needs no wallet to
read.

**Rules → Review → Decision → Record**

GovLayer does not replace a community's judgment. It changes the question put to it.
Instead of asking voters to sift valid proposals from invalid ones, it asks the constitution
first — *does this proposal comply with the rules we agreed to?* — and reserves the vote for
proposals that pass that test. The community then decides whether a *valid* proposal is one
it *wants*.

---

## The Problem

Most on-chain governance treats a decision as a single event: someone posts a proposal,
holders vote, the tally decides. That model is simple, and it leaves real gaps:

- **Voters do the filtering.** Malformed, self-contradictory, or constitutionally invalid
  proposals reach the ballot, and the community spends its attention on them.
- **Rules live outside the process.** A constitution, charter, or set of principles may
  exist, but nothing in the protocol applies it to a proposal before it is voted on.
- **Outcomes arrive without a reasoning chain.** A tally says what happened, not why a
  proposal was allowed to the ballot in the first place.
- **Recourse is ad hoc.** When a proposal is turned away, there is rarely a defined,
  bounded way to challenge that.

GovLayer addresses each of these: review before the vote, a constitution the protocol
itself applies, a recorded reasoning for every review outcome, and a staged, capped dispute
process.

## The GovLayer Approach

A proposal on GovLayer is a record that grows:

- **Proposal** — a title, a description, a requested voting duration, and — for a
  constitution amendment — the proposed constitution text. Submission is gated by the
  community's eligibility rules and a per-address rate limit.
- **Constitutional review** — the proposal is reviewed against the constitution in force at
  submission. The review returns a decision (`accept`, `revise`, or `reject`), a
  plain-language reasoning, and a list of constitutional conflicts, each with a description
  and a severity (`low`, `medium`, `high`; at most ten are kept).
- **Revision** — a proposal that needs revision stays with its proposer, who may resubmit
  it up to a fixed number of times. Every prior version, with the review that judged it, is
  preserved in the proposal's revision history.
- **Vote** — only proposals accepted by review open for voting. Each eligible address casts
  one immutable vote, for or against, inside the voting window the proposer chose.
- **Finalization** — once the window closes, anyone may finalize. The contract computes
  quorum and approval and records the outcome.
- **Dispute** — a proposal rejected in review can be disputed. Each dispute triggers a fresh
  review; stages are capped and separated by a cooldown.
- **Record** — the proposal, its reviews, revisions, disputes, votes, and the constitution
  version it was judged against all stay readable. The constitution's own version history is
  append-only.

## Built on GenLayer

GovLayer runs as **Intelligent Contracts**: each contract method executes across multiple
independent validator nodes, and GenLayer's consensus decides whether their results agree.

- **Review runs inside the transaction.** Constitutional review and dispute resolution call a
  language model from within the contract. The leader produces a result and validators
  independently reproduce it; the result is accepted when the review **decision** agrees.
  The surrounding validation, state change, and event logging are ordinary deterministic
  contract logic.
- **Unusable output never becomes a record.** If the model returns malformed or
  out-of-vocabulary output, the transaction reverts: nothing is stored and no rate-limit slot
  is consumed. A transient model failure cannot turn into a permanent rejection.
- **Untrusted text is fenced.** Titles, descriptions, amendment text, and dispute reasons are
  placed inside tagged blocks with angle brackets neutralized, and the prompt instructs the
  model to treat their content as data to be evaluated, never as instructions.
- **Rules are frozen when voting opens.** Quorum, approval threshold, weight mode,
  eligibility mode, voting token, minimum balance, and token interface are copied onto the
  proposal when its voting window opens (and again if a resubmission or dispute reopens
  voting). A later configuration change never alters a vote already open.

## How a Proposal Moves Through GovLayer

```
submit_proposal()            → review runs in-transaction
                               → pending (accepted) · needs_revision · rejected
resubmit_proposal()          → needs_revision only, proposer only, fresh review
vote()                       → pending only, one immutable vote per address
cancel_proposal()            → proposer only, while pending or needs_revision
finalize_decision()          → permissionless after the window closes
                               → passed · failed · pending_constitution_confirm
raise_dispute()              → rejected only, fresh review, staged and capped
apply_admin_action()         → permissionless: Core pulls an executed Admin authorization
```

**Status vocabulary**

| Status | Meaning |
| --- | --- |
| `pending` | Accepted by review; voting is open until the window closes |
| `needs_revision` | Review asked for changes; the proposer may resubmit |
| `rejected` | Review turned the proposal away (a review outcome) |
| `under_review` | A dispute is being reviewed |
| `passed` | The vote met quorum and the approval threshold |
| `failed` | The vote did not (`quorum_not_met` or `threshold_not_met`) (a vote outcome) |
| `pending_constitution_confirm` | A constitution amendment passed its vote and awaits admin authorization |
| `cancelled` | Withdrawn by its proposer |

`rejected` and `failed` are never the same kind of outcome. `rejected` is a constitutional
review result, and a rejected proposal never reaches a vote. `failed` is a result of the
vote itself. Only a rejected proposal can be disputed.

**What an outcome means.** A standard proposal that reaches `passed` is a recorded community
decision: the protocol records it and does not execute it. A constitution amendment is
different — after it passes its vote it moves to `pending_constitution_confirm`, and it takes
effect only when GovLayerAdmin authorizes it and GovLayerCore pulls that authorization, which
advances the constitution to a new version.

### Limits and defaults

| Parameter | Value |
| --- | --- |
| Title / description / constitution text / dispute reason | 200 / 5,000 / 20,000 / 2,000 characters |
| Quorum (distinct voters) | 3 by default; never below 3 |
| Approval threshold | 60% by default; between 51% and 100% |
| Voting duration | Proposer's choice within the configured bounds (1 hour to 30 days by default; the bounds can be moved, but never outside that range) |
| Resubmissions per proposal | 3 |
| Dispute stages / cooldown between stages | 3 / 1 hour |
| Proposals per address | 7 per 7-day window by default |
| Constitutional conflicts kept per review | 10 |

Quorum, approval threshold, voting-duration bounds, and the rate limit are changed through
admin-authorized actions. The resubmission cap and the dispute stage and cooldown limits are
fixed at deployment.

## Two-Contract Architecture

| Contract | Responsibility | Relationship |
| --- | --- | --- |
| `govlayercore` | Proposals, review, voting, disputes, the constitution and its version history, revision and governance history, rate limiting, eligibility and whitelist configuration | Applies governance outcomes. Reads Admin for the pause flag and pulls executed authorizations. |
| `govlayeradmin` | The admin set and a propose → approve → timelock → execute pipeline for twelve action types | Never calls Core. It authorizes; it holds no proposals, votes, or constitution. |

**GovLayerAdmin authorizes. GovLayerCore applies.** An action that reaches `executed` on
Admin is an authorization record. For the changes Core owns, nothing changes until Core
pulls that record through `apply_admin_action` — which any address may call — and
independently re-validates it against its own current state. Core can decline a pull
permanently, without reverting, if its state has moved since the authorization.

The wiring from Core to Admin is one-time and permanent: `set_admin_contract_address` can be
called once, only by the deployer, and only against an address that answers as an initialized
GovLayerAdmin.

### Deployment order

1. Deploy **GovLayerAdmin**. The deployer becomes its first admin.
2. Deploy **GovLayerCore** with the genesis constitution, eligibility mode, minimum token
   amounts, and weight mode.
3. Call `set_admin_contract_address` on Core, once.
4. Call `add_admin` on Admin to seat the second admin. This one-time bootstrap path
   completes the multisig; every later change to the admin set goes through proposals.
5. For token-based eligibility or weighting, authorize the voting token with a
   `set_token_rules` action — the token address is not a constructor argument.

### Admin actions

Every action passes through the same pipeline: any admin proposes (the creation counts as
the first approval, and a proposer cannot approve their own action), approvals are collected
inside a 24-hour window, a 24-hour timelock follows once the threshold is met, and anyone may
then execute it. The authorization stays valid for 7 days after the timelock ends. The
required approvals scale with the number of admins:

| Admins | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- |
| Approvals required | 2 | 2 | 3 | 3 |

| Action | Applied by |
| --- | --- |
| `add_admin`, `remove_admin` | Admin, at execution |
| `propose_pause`, `propose_unpause` | Admin, at execution (a pause stops new submissions only) |
| `set_rate_limit_params` | Admin records it at execution; Core applies its own copy when it pulls the action |
| `set_voting_parameters` (quorum, threshold, duration bounds) | Core, on pull |
| `set_eligibility_mode`, `set_token_rules`, `set_voting_weight_mode` | Core, on pull |
| `set_whitelist_enabled`, `update_whitelist` | Core, on pull |
| `constitution_update_propose` | Core, on pull — advances the constitution to a new version |

Actions that touch the same setting apply in authorization order, so a stale authorization
cannot undo a newer one; whitelist updates are ordered per address.

## Review & Dispute Model

- **Review is judged against the proposal's own constitution version.** A proposal records
  the constitution version in force when it was submitted; resubmissions and disputes are
  judged against that same text, read from the append-only constitution history. An
  amendment adopted later does not quietly change an earlier judgment.
- **Review outcomes.** `accept` opens voting. `revise` returns the proposal to its proposer
  with the reasoning and conflicts. `reject` ends the proposal's path to a vote unless a
  dispute overturns it.
- **Revision.** Only the proposer can resubmit, only while the proposal needs revision, and
  at most three times. Constitution amendments can also have their amendment text revised.
  The earlier description, decision, reasoning, and conflicts are kept in revision history.
- **Disputes.** Only a rejected proposal can be disputed. The contract allows the proposer or
  an address that voted on it, but a rejected proposal is never opened for voting, so in
  practice it is the proposer. Each dispute carries a written reason and triggers a fresh review.
  There are at most three stages with a one-hour cooldown between them. A dispute that
  overturns a rejection reopens the proposal for voting with a fresh window of the proposer's
  original duration. A dispute never approves a proposal by itself, and a proposal that lost
  its vote cannot be disputed.
- **Eligibility.** A community can run open participation, ERC-20 or NFT holder gating, or
  a custom ERC-20-shaped token, optionally combined with proposer and voter whitelists.
  Both gates apply when both are on. Voting weight is either equal or the token balance at
  the moment of the vote.
- **Votes are immutable.** One vote per address per proposal; it cannot be changed,
  withdrawn, or recast. Each vote is recorded against its address and readable through
  `get_vote`.

## Records & Verification

Every state the protocol holds is readable without a wallet:

- **Proposal record** — status, failure reason, review decision and reasoning, conflicts,
  tallies, the frozen voting rules, the dispute history, and the constitution version it was
  judged against.
- **Revision history** — each prior description, decision, reasoning, and conflict list.
- **Constitution history** — every adopted version with its text, adoption time, the
  proposal it came from, and the admin who proposed its authorization (or `genesis`).
- **Governance history** — an append-only log of lifecycle events and applied admin actions,
  including pulls Core declined.
- **Authorization state** — for any admin action, whether it was proposed, approved,
  timelocked, executed, and whether Core has applied it (`is_admin_action_applied`).

`/verify` accepts a proposal number or an authorized-action identifier (for example
`ACTION-00000003`) and presents a human layer first, then
the technical layer, with no wallet required.

## Technical Architecture

- **Next.js 15** (App Router) · **React 19** · **TypeScript** — server-composed route
  rendering, client-driven participation
- **TanStack Query** — all contract state flows through queries with explicit keys,
  policies, and invalidation after confirmed writes
- **genlayer-js 1.1.8** (exact pin, the sole blockchain gateway) — no second blockchain
  library and no global state library
- **Adapter boundary** — `GovLayerCoreAdapter` and `GovLayerAdminAdapter` are the only code
  that knows a contract address or function name; values leaving them are typed domain
  models, never raw calldata shapes
- **Wallet** — a thin EIP-1193 boundary: no key material, no wallet library; every
  transaction is approved in the wallet. The interface compares the wallet's chain id with
  the deployment's and refuses to send when they differ or cannot be read.
- **Writes** — intent → adapter → transaction → finality → execution result → outcome. A
  transaction that finalizes is never treated as a successful operation on that basis alone;
  the execution result decides, and protocol state is re-read afterwards.
- **Configuration at the boundary** — network preset and contract addresses are validated
  environment values. Missing or malformed configuration produces an explicit
  "configuration incomplete" state; addresses are never invented or defaulted.

| Concern | Choice |
| --- | --- |
| Framework | Next.js 15.3.9 |
| UI runtime | React 19.3.0 |
| Language | TypeScript 5.9.3 |
| Styling | Tailwind CSS 3.4.19 |
| GenLayer access | `genlayer-js` 1.1.8 |
| Server state | TanStack React Query 5.102.8 |
| Icons | Lucide React 1.45.0 |
| Tests | Vitest 2.x |
| Runtime | Node.js 22 LTS, npm 10+ |

## Project Structure

```text
govlayer/
├── README.md
├── LICENSE
├── package.json              ← convenience scripts that delegate to apps/web
├── .nvmrc                    ← Node 22
├── contracts/                ← authoritative protocol source; front-end work never modifies it
│   ├── govlayercore.py       ← proposals, review, voting, disputes, constitution, history
│   ├── govlayeradmin.py      ← multisig + timelock authorization layer
│   ├── examples/             ← sample_gl_token.py (a GenVM-native token), BalanceProbe.py
│   └── tests/                ← standard-library contract test suite, with tools/ and a runtime stand-in
└── apps/
    └── web/                  ← the Next.js front end
        └── src/
            ├── app/          ← routes and page composition
            ├── adapters/     ← Core and Admin adapters, the single SDK gateway
            ├── config/       ← environment validation and network presets
            ├── domain/       ← typed models, mappers, derived state
            ├── lib/          ← formatting, error registry, pagination, time
            ├── queries/      ← query keys, policies, invalidation, read and write hooks
            ├── server/       ← server-side read composition
            ├── wallet/       ← EIP-1193 boundary
            └── components/   ← shell, brand, proposal, participation, stewardship
```

## Running Locally

Node 22 LTS, npm 10+.

```bash
nvm use
npm run install:web

cp apps/web/.env.example apps/web/.env.local   # then fill in real addresses

npm run dev          # local development
npm run build        # production build
npm run lint
npm run typecheck
npm test             # front-end unit tests
npm run smoke        # live read-only smoke test against the deployed contracts
```

A phase of front-end work is complete only when install, typecheck, lint, unit tests,
production build, configuration validation, and the live smoke test all pass. The smoke test
is read-only and safe to re-run at any time.

### Contract tests

The contract suite uses only the Python standard library — no `pip install`, no network, no
GenLayer node.

```bash
cd contracts
python -m unittest discover -s tests -v          # 251 tests
python tests/coverage_report.py --show-missing   # line coverage of both contracts (99.8%)
python tests/tools/mutation_check.py             # 61 mutants; every one must be killed
python tests/tools/ast_compare.py old.py new.py  # prove two versions differ only in comments
```

Core is mostly tested wired to the real GovLayerAdmin, so ordering and expiry tests use
genuine multisig and timelock timestamps. The suite also freezes the front-end-facing
surface: public methods, parameters, view keys, and event-text formats cannot be removed or
renamed without a deliberate change to the baseline.

The tests run on a small in-process stand-in for the GenVM `genlayer` module. It models
storage, the transaction clock and sender, whole-transaction rollback, cross-contract views,
and a leader/validator round driven by a scripted fake model. It does **not** model real
consensus or validator disagreement, gas, real EVM calls, or real model behaviour. The tests
prove the contract logic; they are not a substitute for running the contracts on a GenLayer
network.

## Studionet Deployment

| | |
|---|---|
| Chain ID | `61999` |
| RPC | `https://studio.genlayer.com/api` |

| | |
| --- | --- |
| Network | GenLayer Studionet |
| GovLayerCore | `0xB719b328D0b02d39b20DCc777Cd82c8d724661C9` |
| GovLayerAdmin | `0xdbf8E02B02b1d87ea0599f8F03988f102bd7625A` |

The RPC endpoint, chain id, and explorer come from the `genlayer-js` `studionet` preset.
Add the network to an injected wallet before writing. Browsing and verification never need
a wallet.

`apps/web/.env.production` is committed and targets this deployment, so a production build
always points at a real deployment. The addresses stay in configuration, never in code. A
variable set in the Vercel project, in CI, or in `.env.local` overrides the committed file:

```
real environment variables  >  .env.production.local  >  .env.local
                            >  .env.production        >  .env
```

On Vercel, set the project root directory to `apps/web`.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_GENLAYER_NETWORK` | Network preset (currently `studionet`) |
| `NEXT_PUBLIC_GOVLAYER_CORE_ADDRESS` | GovLayerCore deployment address |
| `NEXT_PUBLIC_GOVLAYER_ADMIN_ADDRESS` | GovLayerAdmin deployment address |
| `NEXT_PUBLIC_ENABLE_FIXTURES` | Isolated UI development only; defaults to `false` |

## Routes

| Route | Surface |
| --- | --- |
| `/` | Home |
| `/how-it-works` | Lifecycle explanation |
| `/explore` | The governance record, with state filters and bounded paging |
| `/proposals/:id` | The Living Decision Record |
| `/constitution`, `/constitution/history`, `/constitution/:version` | Constitution and its version history |
| `/verify`, `/verify/:identifier` | Verification: human layer, then technical layer |
| `/proposals/new` | Create a proposal, staged: Define → Constitutional context → Review → Submit |
| `/proposals/:id/revise` | Revise a proposal that needs revision (proposer only) |
| `/proposals/:id/dispute` | Raise a bounded dispute on a review-rejected proposal |
| `/governance/me` | What needs the connected address's attention |
| `/stewardship` | Overview of protocol stewardship |
| `/stewardship/actions`, `/stewardship/actions/:id` | Every authorized action, from proposal to Core application |
| `/stewardship/configuration` | Governance configuration, grouped, with propose actions |
| `/stewardship/admins` | Admin membership and its history |
| `/proposals` | Redirects to `/explore` |

Everything through `/verify/:identifier` is read-only and works without a wallet. The
participation routes state their wallet requirement plainly and never present a wallet or
network condition as an eligibility answer.

## Design & Product Philosophy

- **Honest data.** Every displayed value is protocol-sourced, derived from protocol values,
  or presentational — never mixed. Nothing is fabricated: no validator identities, no
  consensus percentages, no invented activity, no speculative states.
- **Two outcomes, two names.** `rejected` and `failed` never share wording or tone.
- **Unverified is not negative.** A read that fails is reported as *unverified*. "Could not
  verify" is never presented as "ineligible."
- **A transaction hash is not success.** The execution result decides, and state is
  re-read afterwards.
- **State is never carried by colour alone.** Every status is an icon plus a label, and the
  decision journey, action pipeline, and status strips read as ordered lists of sentences.
- **Accessibility baseline.** Semantic landmarks, a skip link, visible keyboard focus,
  labelled controls, measured contrast, and `prefers-reduced-motion` respected.
- **Motion has one job.** A recorded write outcome fades in over 180ms; nothing animates
  continuously and nothing implies protocol activity that did not happen.
- **Wallets are action tools.** Browsing and verification work without one.

## Current Status & Limitations

- **Studionet deployment.** The contracts and interface run on GenLayer's Studionet, a test
  network.
- **Action history is walked, not listed.** GovLayerAdmin exposes no action count, so the
  interface assembles history by walking the action-id space and shows the read cost.
- **No application time for Admin-applied actions.** No contract records an application or
  expiry time for the action types Admin applies itself, so those cannot be listed by time.
- **Rate limits are shown from Admin.** Core enforces its own copy of the rate limit,
  updated when it pulls a `set_rate_limit_params` action. The stewardship screens currently
  treat that action as Admin-applied and read Admin's recorded value, so they do not yet show
  whether Core has applied it.
- **Vote lookups are not surfaced.** Core records each vote against its address and exposes
  it through `get_vote`; the interface shows the tally and does not yet read individual
  votes, so "already voted" is discovered when the contract refuses a second attempt.
- **Amendment-text revision is not in the interface.** Core supports revising a
  constitution amendment's text on resubmission (`resubmit_proposal_with_amendment`); the
  revise screen currently edits the description only.
- **Token balance preview.** The eligibility preview reads token balances through
  `genlayer-js` using the `balance_of` spelling. Core tries the standard `balanceOf` first
  and falls back to `balance_of`, so a preview for an EVM token can show as unverifiable
  when Core would accept it. Core's answer is authoritative.

---

*GovLayer is built on GenLayer — the first blockchain designed natively for AI.*
*Two contracts. One authorization boundary. Rules, review, decision, record.*
