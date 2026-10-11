import { RouteLoading } from "@/components/shared/RouteLoading";

/** Experience Blueprint section 13: name what is being loaded. */
export default function Loading() {
  return (
    <RouteLoading
      subject="Loading your governance position"
      detail="Reading the most recent proposals so this surface can say what needs your attention. This surface does not read whether an address has voted, so nothing here claims it."
    />
  );
}
