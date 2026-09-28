import { RouteLoading } from "@/components/shared/RouteLoading";

/** Experience Blueprint section 13: name what is being loaded. */
export default function Loading() {
  return (
    <RouteLoading
      subject="Checking stewardship actions"
      detail="Reading the authorized actions from the stewardship contract. Actions that expire or fail revalidation are recorded outcomes, not errors, and are reported as such."
    />
  );
}
