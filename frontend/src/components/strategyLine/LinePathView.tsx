type Props = {
  labels: string[];
  missingLabel?: string | null;
};

export default function LinePathView({ labels, missingLabel }: Props) {
  if (!labels.length && !missingLabel) {
    return <p className="muted line-path-empty">Нет префлоп-линии</p>;
  }
  return (
    <ol className="line-path" aria-label="Линия раздачи">
      {labels.map((label, i) => (
        <li key={`${i}-${label}`} className="line-path-step">
          <span>{label}</span>
        </li>
      ))}
      {missingLabel ? (
        <li className="line-path-step line-path-step--missing">
          <span>? {missingLabel}</span>
        </li>
      ) : null}
    </ol>
  );
}
