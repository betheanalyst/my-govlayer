"use client";

import Link from "next/link";
import { shortenAddress } from "@/lib/hex";
import {
  ADMIN_APPLIED_ACTION_TYPES,
  compareActionIdsDescending,
} from "@/domain/stewardship";
import { useAdminMembership, useAdminSnapshot } from "@/queries/adminQueries";
import { useScannedAdminActions } from "@/queries/stewardshipQueries";
import { useWallet } from "@/wallet/WalletProvider";
import { ProposeForm, parseTextField } from "@/components/stewardship/ProposeForm";
import { ConfigurationIncompleteNotice } from "@/components/shared/Notices";
import { inspectRuntimeConfig } from "@/config/env";
import { PageHeader, SectionHeading } from "@/components/shared/Primitives";
import { ActionSummaryList } from "@/components/stewardship/ActionSummaryList";

/** The contract's enforced removal floor: MIN_ADMINS_POST_BOOTSTRAP + 1. */
const REMOVAL_FLOOR = 4;

/**
 * Steward membership (Experience Blueprint section 10.19).
 *
 * Who the stewards are, how many approvals an action needs, and the membership
 * history — without rehearsing the contract's internal epoch mechanics.
 */
export default function StewardshipAdminsPage() {
  const wallet = useWallet();
  const membership = useAdminMembership(wallet.address ?? undefined);
  const snapshot = useAdminSnapshot();
  const scan = useScannedAdminActions({ enabled: true, maxScan: 100 });

  const now = Math.floor(Date.now() / 1000);
  const canPropose = membership.data === true;
  const bootstrapComplete = snapshot.data?.bootstrapComplete === true;
  const unavailableReason =
    wallet.address === null
      ? "Connect a steward wallet to propose a membership change. Reading this page needs no wallet."
      : membership.data === undefined
        ? "Checking whether the connected address is a steward…"
        : "Only a current steward can propose a membership change.";

  const membershipActions = [...(scan.data?.actions ?? [])]
    .filter((action) =>
      (ADMIN_APPLIED_ACTION_TYPES as readonly string[]).includes(action.actionType),
    )
    .sort((left, right) => compareActionIdsDescending(left.actionId, right.actionId));

  const inspected = inspectRuntimeConfig();
  if (!inspected.ok) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Stewardship" title="Stewards" />
        <div className="mt-10">
          <ConfigurationIncompleteNotice issues={inspected.error.issues} />
        </div>
      </main>
    );
  }


  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Stewardship"
        title="Stewards"
        lede="Stewards authorize changes to the DAO. Membership is changed the same way as everything else: an authorized action, steward approvals, a timelock, and then the stewardship contract applying it."
      >
        <p className="text-sm">
          <Link href="/stewardship" className="underline">
            Back to stewardship
          </Link>
        </p>
      </PageHeader>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-12">
          <section aria-labelledby="change-heading" className="space-y-6">
            <SectionHeading
              id="change-heading"
              title="Change membership"
              description="The bootstrap form is available only while the DAO still has a single steward."
            />

            {bootstrapComplete ? null : (
              <ProposeForm
                title="Add the second steward (bootstrap)"
                description="Bootstrap is the one-time step that brings a second steward into the DAO. Until it is done, no other stewardship action is available."
                canPropose={canPropose}
                unavailableReason={unavailableReason}
                fields={[
                  {
                    name: "address",
                    label: "Steward address",
                    kind: "text",
                    placeholder: "0x…",
                  },
                ]}
                build={(values) => {
                  const address = parseTextField(values, "address", "Steward address");
                  if ("error" in address) return { error: address.error };
                  return {
                    request: { kind: "bootstrap_admin", address: address.value },
                  };
                }}
              />
            )}

            <ProposeForm
              title="Add a steward"
              description="Proposes adding an address to protocol stewardship."
              canPropose={canPropose && bootstrapComplete}
              unavailableReason={
                bootstrapComplete
                  ? unavailableReason
                  : "Available once bootstrap is complete."
              }
              fields={[
                {
                  name: "address",
                  label: "Steward address",
                  kind: "text",
                  placeholder: "0x…",
                },
              ]}
              build={(values) => {
                const address = parseTextField(values, "address", "Steward address");
                if ("error" in address) return { error: address.error };
                return { request: { kind: "propose_add_admin", address: address.value } };
              }}
            />
            <ProposeForm
              title="Remove a steward"
              description={`Proposes removing an address from stewardship. The contract accepts a removal only while at least ${REMOVAL_FLOOR} stewards are active, so a removal can never strand the DAO below a workable approvals threshold.`}
              canPropose={canPropose && bootstrapComplete}
              unavailableReason={
                bootstrapComplete
                  ? unavailableReason
                  : "Available once bootstrap is complete."
              }
              fields={[
                {
                  name: "address",
                  label: "Steward address",
                  kind: "text",
                  placeholder: "0x…",
                },
              ]}
              build={(values) => {
                const address = parseTextField(values, "address", "Steward address");
                if ("error" in address) return { error: address.error };
                return {
                  request: { kind: "propose_remove_admin", address: address.value },
                };
              }}
            />
          </section>

          <section aria-labelledby="history-heading" className="space-y-4">
            <SectionHeading
              id="history-heading"
              title="Membership and pause history"
              description="Every authorized action of these types, newest proposal first. The contracts record no application time for them, so this is ordered by when each was proposed."
            />
            <ActionSummaryList
              actions={membershipActions}
              now={now}
              requiredApprovalsFor={() => snapshot.data?.currentThreshold ?? null}
              emptyText={
                scan.data === undefined
                  ? "Walking the authorized-action id space…"
                  : "No membership or pause action has been created on this deployment."
              }
            />
          </section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-8 lg:self-start">
          <div>
            <p className="text-sm font-medium text-ink">Current stewards</p>
            {snapshot.data === undefined ? (
              <p className="mt-2 text-sm text-ink-muted">
                Reading the stewardship contract…
              </p>
            ) : (
              <>
                <p className="mt-2 text-xs text-ink-subtle">
                  {snapshot.data.activeAdminCount} active ·{" "}
                  {snapshot.data.admins.length} recorded ·{" "}
                  {snapshot.data.currentThreshold} approval
                  {snapshot.data.currentThreshold === 1 ? "" : "s"} required
                </p>
                <ul className="mt-3 space-y-1 text-sm">
                  {snapshot.data.admins.map((admin) => (
                    <li key={admin} className="code-value text-ink-muted">
                      {shortenAddress(admin)}
                      {wallet.address !== null &&
                      admin.toLowerCase() === wallet.address.toLowerCase() ? (
                        <span className="ml-2 font-sans text-xs text-accent-strong">
                          you
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-ink-subtle">
                  {snapshot.data.bootstrapComplete
                    ? "Bootstrap is complete, so the full stewardship flow is available."
                    : "Bootstrap is not complete: this DAO has one steward, and only the bootstrap step is available."}
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
