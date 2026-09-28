import Link from "next/link";
import { PageHeader } from "@/components/shared/Primitives";

/**
 * Not found.
 *
 * The interface never guesses what the visitor meant: it says the record was not
 * found and offers the surfaces where records can be located.
 */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Not found"
        title="No record here"
        lede="There is nothing at this address. Either it was mistyped, or the record it referred to does not exist on chain."
      />
      <p className="mt-8 max-w-prose text-sm text-ink-muted">
        Records can be located from{" "}
        <Link href="/explore" className="underline">
          Explore
        </Link>
        , read in the{" "}
        <Link href="/constitution" className="underline">
          constitution
        </Link>
        , or resolved by identifier through{" "}
        <Link href="/verify" className="underline">
          Verify
        </Link>
        .
      </p>
    </main>
  );
}
