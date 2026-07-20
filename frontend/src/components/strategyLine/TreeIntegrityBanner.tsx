import type { LineIntegrity } from "../../engine/lineAnalysis";

type Props = {
  integrity: LineIntegrity | null;
};

export default function TreeIntegrityBanner({ integrity }: Props) {
  if (!integrity) return null;
  const lost = integrity.lost.length;
  const dup = integrity.overlapping.length;
  if (!lost && !dup) return null;
  return (
    <p className="tree-integrity-banner" role="status">
      Целостность вилки:
      {lost ? ` потеряно ${lost} комбо` : null}
      {lost && dup ? ";" : null}
      {dup ? ` дублируется ${dup} комбо` : null}
      {" "}
      (родитель {integrity.parentReachCount} → дети {integrity.childCoveredCount}).
    </p>
  );
}
