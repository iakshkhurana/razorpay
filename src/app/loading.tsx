import { LoadingState } from "@/components/RouteProgress";

/** Route-level loading UI: a blue spinner and "Loading…" on mist while a page's tree streams in. */
export default function Loading() {
  return <LoadingState />;
}
