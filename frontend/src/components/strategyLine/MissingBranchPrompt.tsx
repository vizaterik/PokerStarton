type Props = {
  pathLabels: string[];
  missingLabel: string;
  busy?: boolean;
  onCreate: () => void;
};

export default function MissingBranchPrompt({
  pathLabels,
  missingLabel,
  busy,
  onCreate,
}: Props) {
  return (
    <div className="missing-branch-prompt" role="status">
      <p>
        <strong>Ветка отсутствует</strong>
        {pathLabels.length ? (
          <>
            {" "}
            после «{pathLabels.join(" → ")}»
          </>
        ) : null}
        : нужен ход <em>{missingLabel}</em>.
      </p>
      <button
        type="button"
        className="missing-spot-add"
        disabled={busy}
        onClick={onCreate}
      >
        {busy ? "Создаём…" : "Создать ветку"}
      </button>
    </div>
  );
}
