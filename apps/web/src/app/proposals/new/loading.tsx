import { RouteLoading } from "@/components/shared/RouteLoading";

/** Experience Blueprint section 13: name what is being loaded. */
export default function Loading() {
  return (
    <RouteLoading
      subject="Loading constitutional context"
      detail="Reading the constitution in force and this DAO's submission rules. Nothing is sent until you confirm it in your wallet."
    />
  );
}
