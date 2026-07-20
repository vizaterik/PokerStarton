import type { HandLineAnalysis } from "../../engine/lineAnalysis";
import BranchRangeSplit from "./BranchRangeSplit";
import LinePathView from "./LinePathView";
import MissingBranchPrompt from "./MissingBranchPrompt";
import TreeIntegrityBanner from "./TreeIntegrityBanner";

type Props = {
  analysis: HandLineAnalysis;
  busy?: boolean;
  onCreateBranch?: () => void;
  onOpenReplay?: () => void;
};

export default function HandLineDetail({
  analysis,
  busy,
  onCreateBranch,
  onOpenReplay,
}: Props) {
  if (analysis.status === "empty") {
    return <p className="muted">Нет префлоп-действий героя.</p>;
  }

  if (analysis.status === "missing_branch") {
    return (
      <div className="hand-line-detail">
        <LinePathView labels={analysis.pathLabels} missingLabel={analysis.missingLabel} />
        {onCreateBranch ? (
          <MissingBranchPrompt
            pathLabels={analysis.pathLabels}
            missingLabel={analysis.missingLabel}
            busy={busy}
            onCreate={onCreateBranch}
          />
        ) : (
          <p className="muted">Ветка отсутствует: {analysis.missingLabel}</p>
        )}
        {onOpenReplay ? (
          <button type="button" className="missing-spot-add" onClick={onOpenReplay}>
            Реплей
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="hand-line-detail">
      <div className="hand-line-detail-head">
        <span className={analysis.inRange ? "line-badge ok" : "line-badge bad"}>
          {analysis.inRange ? "В стратегии" : "Отклонение"}
        </span>
        {analysis.heroHandCode ? (
          <span className="muted">{analysis.heroHandCode}</span>
        ) : null}
      </div>
      <LinePathView labels={analysis.pathLabels} />
      <BranchRangeSplit splits={analysis.splits} heroAction={analysis.heroAction} />
      {analysis.deviationText ? (
        <p className="line-deviation-text">{analysis.deviationText}</p>
      ) : null}
      <TreeIntegrityBanner integrity={analysis.integrity} />
      {onOpenReplay ? (
        <button type="button" className="missing-spot-add" onClick={onOpenReplay}>
          Реплей
        </button>
      ) : null}
    </div>
  );
}
