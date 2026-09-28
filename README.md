# GovLayer

A governance system in which a proposal must first demonstrate constitutional
compliance before the community decides whether it should pass.

**Rules → Review → Decision → Record**

GovLayer is a GenLayer protocol with two on-chain contracts and a web front end
that makes the protocol's rules, review, participation, outcomes, and records
legible as one continuous experience.

---

## Repository layout

```text
govlayer/
├── package.json            # convenience scripts that delegate to apps/web
├── .nvmrc                  # Node 22
├── .gitignore
├── contracts/              # authoritative protocol source -- do not modify
│   ├── govlayercore.py     # proposals, voting, disputes, constitution, history
│   └── govlayeradmin.py    # multisig + timelock authorization layer
└── apps/
    └── web/                # Next.js front end (all product code lives here)
```

The GovLayer product/UX directive and the front-end foundation standard are
**working documents held outside this repository**. They are deliberately not
packaged here.

### The contracts are authoritative

`contracts/govlayercore.py` and `contracts/govlayeradmin.py` define what exists,
what happened, who is authorized, and what every governance concept means. Where
documentation and contract behaviour disagree, the contracts win. They are never
modified by front-end work.

The trust boundary they establish is visible throughout the product:

> **GovLayerAdmin authorizes. GovLayerCore applies.**

An action reaching `executed` on Admin is authorization only. Core independently
re-validates it against its own current state and may apply it or permanently
reject the pull.

---

## The web application

### Locked stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 15.3.9 (App Router) |
| UI runtime | React 19.3.0 |
| Language | TypeScript 5.9.3 |
| Styling | Tailwind CSS 3.4.19 |
| GenLayer access | `genlayer-js` 1.1.8 (exact pin, sole blockchain gateway) |
| Server state | TanStack React Query 5.102.8 |
| Motion | Framer Motion 13.2.0 (installed per the approved stack; the single motion case is CSS, see below) |
| Icons | Lucide React 1.45.0 |
| Utilities | clsx 2.1.1, tailwind-merge 2.5.2 |
| Runtime | Node.js 22 LTS, npm 10+ |
| Tests | Vitest 2.x |

No second blockchain library (wagmi, RainbowKit, WalletConnect/Reown, ethers,
web3.js, or direct viem) and no global state library is used. All GenLayer calls
sit behind adapters so a network migration stays a configuration change.

### Source layout

```text
apps/web/src/
├── app/            # routes and page composition
├── adapters/       # GovLayerCoreAdapter, GovLayerAdminAdapter, the single SDK gateway
├── config/         # environment validation and network presets
├── domain/         # typed models, contract-to-domain mappers, derived state
├── lib/            # formatting, error registry, pagination, time, cn()
├── queries/        # React Query keys, policies, invalidation, read + write hooks
├── server/         # server-side read composition for route rendering
├── wallet/         # EIP-1193 boundary: connection state, connect UI, wallet errors
└── components/     # shell, brand, shared primitives, proposal, participation, stewardship
```

Reads flow `UI → query → adapter → genlayer-js → mapper → typed model`. Writes
flow `intent → adapter → transaction → finality → execution result → outcome`.

### Honest data rules

These are product requirements, not stylistic preferences:

- Every displayed value is **protocol-sourced**, **derived from protocol values**,
  or **presentational**. The three are never mixed.
- Nothing is fabricated: no validator identities, consensus percentages, AI
  confidence scores, invented activity, or speculative states such as
  `almost_passed`.
- `rejected` (a constitutional-review outcome) and `failed` (a post-vote
  governance outcome) are never presented as the same kind of outcome.
- A finalized transaction is never treated as a successful operation. The
  transaction's own execution result decides, and protocol state is re-read
  afterwards.
- A read that fails is reported as **unverified**, never as a negative answer
  ("could not verify" is not "ineligible").

### Accepted protocol limitations

Where the contracts expose no data, the product does not invent it. Notable
consequence: GovLayerCore records vote tallies but exposes **no per-voter view**
(no "has this address voted", no individual vote weights). The interface handles
this explicitly rather than simulating it.


---

## Getting started

```bash
# Node 22 (see .nvmrc)
nvm use

# install the web app dependencies
npm run install:web

# configure the deployment (see apps/web/.env.example)
cp apps/web/.env.example apps/web/.env.local   # then fill in real addresses
```

Required configuration:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_GENLAYER_NETWORK` | Network preset (currently `studionet`) |
| `NEXT_PUBLIC_GOVLAYER_CORE_ADDRESS` | GovLayerCore deployment address |
| `NEXT_PUBLIC_GOVLAYER_ADMIN_ADDRESS` | GovLayerAdmin deployment address |
| `NEXT_PUBLIC_ENABLE_FIXTURES` | Fixture mode; defaults to `false` |

Configuration is validated at the boundary. Missing or malformed values produce
an explicit "configuration incomplete" state; addresses are never invented or
defaulted.

```bash
npm run dev        # local development
npm run build      # production build
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm test           # unit tests
npm run smoke      # live read-only smoke test against the deployed contracts
```

### Validation gates

A phase is complete only when all of these pass: dependency install, typecheck,
lint, unit tests, production build, configuration validation, and the live
smoke test. The smoke test is read-only and safe to re-run at any time.

---

## Deployment

The deployable application is `apps/web`. On Vercel, set the project root
directory to `apps/web` and provide the three `NEXT_PUBLIC_*` variables above
per environment. Contract addresses are configuration, never code.

---

## Build status

| Area | Status |
| --- | --- |
| Phase 1 — foundation and live pipe verification | complete |
| Phase 2 — domain models, derived state, query and invalidation layer | complete |
| Phase 3 — product shell and public experience | complete |
| Phase 4 — participation (wallet, create, vote, finalize, revise, dispute, My governance) | complete |
| Phase 5 — stewardship (overview, actions, configuration, stewards) | complete |
| Phase 6 — system states, accessibility, motion and packaging | complete |
| Home, How it works, Explore, proposal record, Constitution, Verify | live reads from both contracts, no wallet required |
| Participation surfaces | live reads and writes through the connected wallet |
| Stewardship surfaces | live reads, and authorized writes for connected stewards |

### Wallet

The wallet layer is a thin EIP-1193 boundary, as the Foundation Standard
prescribes:

- **No wallet library and no key material.** The application never asks for a
  private key or a recovery phrase, never stores one, and never signs on its own.
  Every transaction is approved inside the wallet.
- **Signing goes through the provider.** genlayer-js routes signing methods
  through the configured provider when the client's account is a bare address, so
  a connected address plus the injected provider is the whole write path.
- **The wallet's network is verified here, fail closed.** genlayer-js skips its
  own chain assertion for studio chains, so this interface compares the wallet's
  reported chain id with the deployment's and refuses to send when they differ or
  cannot be read.
- **No fabricated participation data.** GovLayerCore records tallies rather than
  voters, so the interface cannot show who voted, or which proposals an address
  voted on. Those questions are answered by the contract at the moment of voting,
  and the interface says so instead of guessing.

### Stewardship

GovLayerAdmin authorizes; GovLayerCore applies. The interface keeps that boundary
visible rather than collapsing it:

- The five action types the stewardship contract applies **itself** at execution
  are steward membership, rate limits and the submission pause. The other seven
  reach `executed` as an authorization only, and the change takes effect when
  GovLayerCore pulls the record — which any address may do.
- Core can **decline a pull permanently** if its state moved after authorization,
  without reverting. The action detail reports applied / declined / unconfirmed
  from Core's own views, never from the transaction's status alone.
- Three stewardship writes have **non-reverting outcomes**: an approval past its
  window, and an execution that fails revalidation, are recorded as `expired`
  rather than failing. The result panel states what the contract recorded.
- Approval window, timelock and threshold changes are read live, so the surface
  never shows a countdown that has already passed or a requirement that has moved.

Two limits are stated rather than worked around: the stewardship contract exposes
no action count, so history is assembled by walking the action-id space (with the
read cost shown), and no contract records an application or expiry *time* for the
action types the stewardship contract applies itself, so those cannot be listed
by time.

### System states, accessibility and motion

- **Loading, empty and error states are part of the product.** Every route states
  what it is reading ("Loading proposal record…", "Checking stewardship action…",
  "Verifying governance record…"), empty states explain why they are empty and
  what happens next, and a failed read is reported as verification uncertainty
  rather than as a negative answer.
- **State is never carried by colour alone.** Every status is rendered as an icon
  plus a text label, and `rejected`, `failed`, `cancelled` and `needs_revision`
  keep separate wording and separate tone families. A unit test guards this, so
  they cannot drift into interchangeable badges.
- **Accessibility baseline.** Semantic landmarks and lists, a skip link, visible
  keyboard focus, labelled form controls, native disclosure elements, and text
  alternatives for every visualisation — the decision journey, the action
  pipeline and every status strip read as an ordered list of sentences.
- **Contrast.** The palette was measured, not eyeballed: meta text was darkened
  from 3.7:1 to above 4.5:1 on both surfaces, and interactive control boundaries
  use a token that clears the 3:1 requirement for identifying a control, while
  panels and dividers keep the quieter decorative tokens.
- **Motion has three jobs — explain, confirm, orient — and one case uses it.** The
  appearance of a recorded write outcome fades in over 180ms, and
  `prefers-reduced-motion` removes it. It is declared in CSS rather than through
  the installed animation library, because the Standard's motion section asks for
  lightweight CSS where that suffices and an animation runtime would have added
  roughly 40 kB to every write surface to move one element four pixels. Nothing
  animates continuously, and no animation implies protocol activity that did not
  happen.
- **Responsive.** On mobile the current state and the available action come
  first, with the decision journey (already a vertical sequence) following, rather
  than a desktop dashboard being collapsed.

### Routes

| Route | Surface |
| --- | --- |
| `/` | Home |
| `/how-it-works` | Lifecycle explanation |
| `/explore` | Governance record, with state filters and bounded paging |
| `/proposals/:id` | The Living Decision Record |
| `/constitution`, `/constitution/history`, `/constitution/:version` | Constitution and version history |
| `/verify`, `/verify/:identifier` | Verification, human layer then technical layer |
| `/proposals/new` | Create Proposal, staged: Define → Constitutional context → Review → Submit |
| `/proposals/:id/revise` | Revise a proposal that needs revision (proposer only) |
| `/proposals/:id/dispute` | Raise a bounded dispute on a review-rejected proposal |
| `/governance/me` | My governance: what requires the connected address's attention |
| `/stewardship` | Protocol stewardship: the five Blueprint priorities |
| `/stewardship/actions` | Every authorized action, by walking the action-id space |
| `/stewardship/actions/:id` | One authorized action, from proposal to Core application |
| `/stewardship/configuration` | Governance configuration, grouped, with propose actions |
| `/stewardship/admins` | Steward membership and the membership history |
| `/proposals` | Redirects to `/explore`: the documented route resolves to the one collection surface rather than duplicating it |

Everything above to `/verify/:identifier` is read-only and works without a
wallet. The participation routes state their wallet requirement honestly when no
usable wallet is present, and never present a wallet or network condition as an
eligibility or protocol answer.

## Values shown by the interface

Every value comes from the contracts, and each is read through a named view
rather than being hardcoded:

| Value | Source |
| --- | --- |
| Proposal status, review outcome, conflicts, dispute history | `get_proposal` |
| Eligibility mode, weight mode, token rules, whitelist toggles | `get_config` |
| Quorum, approval threshold, voting duration bounds | `get_config` |
| Rate limits, resubmission cap, dispute stages and cooldown | `get_config` |
| Constitution version and version history | `get_config`, `get_constitution_history` |
| Stewards, threshold, pause state, bootstrap state | GovLayerAdmin views |
| Authorized-action lifecycle and Core application | `get_action`, `is_admin_action_applied` |
