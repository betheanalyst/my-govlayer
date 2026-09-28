"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StewardshipRequest } from "@/queries/stewardshipWriteHooks";
import { useStewardshipAction } from "@/queries/stewardshipWriteHooks";
import { useWallet } from "@/wallet/WalletProvider";
import { Panel } from "@/components/shared/Primitives";
import { WriteResultPanel } from "@/components/participation/WriteResultPanel";

/**
 * A stewardship proposal form.
 *
 * One component serves every `propose_*` field set: callers supply field
 * descriptors and a builder that turns entered values into a request, so
 * validation and error reporting stay in one place.
 *
 * Every form states the same thing up front, because it is this area's most
 * important fact: proposing is only the first step. Stewards must approve, a
 * timelock must elapse, and for most action types GovLayerCore then applies the
 * change independently.
 */

export interface ProposeField {
  readonly name: string;
  readonly label: string;
  readonly kind: "text" | "integer" | "select" | "checkbox";
  readonly options?: readonly string[];
  readonly placeholder?: string;
  readonly hint?: string;
  readonly initial?: string;
}

export type ProposeBuildResult =
  | { readonly request: StewardshipRequest }
  | { readonly error: string };

export function ProposeForm({
  title,
  description,
  fields,
  build,
  canPropose,
  unavailableReason,
}: {
  readonly title: string;
  readonly description: string;
  readonly fields: readonly ProposeField[];
  readonly build: (values: Readonly<Record<string, string>>) => ProposeBuildResult;
  /** True when the connected address is an active steward. */
  readonly canPropose: boolean;
  readonly unavailableReason: string | null;
}) {
  const router = useRouter();
  const wallet = useWallet();
  const stewardship = useStewardshipAction();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((field) => [
        field.name,
        field.initial ?? (field.kind === "checkbox" ? "false" : ""),
      ]),
    ),
  );
  const [buildError, setBuildError] = useState<string | null>(null);

  const blocked = wallet.writeBlockedReason;

  function submit() {
    const result = build(values);
    if ("error" in result) {
      setBuildError(result.error);
      return;
    }
    setBuildError(null);
    void stewardship
      .mutateAsync(result.request)
      .then(() => router.refresh())
      .catch(() => undefined);
  }

  return (
    <Panel tone="sunken">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">{description}</p>
      <p className="mt-2 max-w-prose text-xs text-ink-subtle">
        Proposing is the first step only: this needs steward approvals and then a
        timelock. GovLayerCore applies it afterwards, except for steward
        membership, rate limits and the submission pause, which the stewardship
        contract applies itself.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.name}>
            <label
              htmlFor={`${title}-${field.name}`}
              className="text-xs font-medium text-ink"
            >
              {field.label}
            </label>
            {field.kind === "select" ? (
              <select
                id={`${title}-${field.name}`}
                value={values[field.name] ?? ""}
                onChange={(event) =>
                  setValues({ ...values, [field.name]: event.target.value })
                }
                className="mt-1 w-full rounded-card border border-line-control bg-surface-raised px-3 py-2 text-sm text-ink"
              >
                <option value="">Select…</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.kind === "checkbox" ? (
              <input
                id={`${title}-${field.name}`}
                type="checkbox"
                checked={values[field.name] === "true"}
                onChange={(event) =>
                  setValues({
                    ...values,
                    [field.name]: event.target.checked ? "true" : "false",
                  })
                }
                className="mt-2 block"
              />
            ) : (
              <input
                id={`${title}-${field.name}`}
                inputMode={field.kind === "integer" ? "numeric" : "text"}
                value={values[field.name] ?? ""}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setValues({ ...values, [field.name]: event.target.value })
                }
                className="mt-1 w-full rounded-card border border-line-control bg-surface-raised px-3 py-2 text-sm text-ink"
              />
            )}
            {field.hint === undefined ? null : (
              <p className="mt-1 text-xs text-ink-subtle">{field.hint}</p>
            )}
          </div>
        ))}
      </div>

      {buildError === null ? null : (
        <p className="mt-3 text-sm text-state-review-rejected">{buildError}</p>
      )}

      <button
        type="button"
        disabled={!canPropose || stewardship.isPending || blocked !== null}
        onClick={submit}
        className="mt-4 rounded-card bg-accent px-5 py-2.5 text-sm font-medium text-ink-inverse hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {stewardship.isPending ? "Waiting for the network…" : title}
      </button>

      {canPropose ? null : (
        <p className="mt-3 max-w-prose text-xs text-ink-subtle">
          {unavailableReason ??
            "Only a current steward can propose a stewardship action."}
        </p>
      )}

      <div className="mt-4">
        <WriteResultPanel
          pending={stewardship.isPending}
          report={stewardship.data ?? null}
          error={stewardship.error ?? null}
        />
      </div>
    </Panel>
  );
}

/** Parses a whole-number field, rejecting anything else rather than rounding. */
export function parseIntegerField(
  values: Readonly<Record<string, string>>,
  name: string,
  label: string,
): { readonly value: bigint } | { readonly error: string } {
  const raw = (values[name] ?? "").trim();
  if (!/^\d+$/.test(raw)) {
    return { error: `${label} must be a whole number.` };
  }
  return { value: BigInt(raw) };
}

/** Parses a required text field. */
export function parseTextField(
  values: Readonly<Record<string, string>>,
  name: string,
  label: string,
): { readonly value: string } | { readonly error: string } {
  const raw = (values[name] ?? "").trim();
  if (raw === "") return { error: `${label} is required.` };
  return { value: raw };
}
