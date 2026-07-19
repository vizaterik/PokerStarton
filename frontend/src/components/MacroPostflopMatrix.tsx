import { useMemo, useState } from "react";
import {
  MACRO_ACTIONS,
  MACRO_BOARDS,
  MACRO_HANDS,
  MACRO_POT_TYPES,
  MACRO_ROLES,
  MACRO_SIZINGS,
  MacroAction,
  MacroBoard,
  MacroCellRule,
  MacroHand,
  MacroPostflopProfile,
  MacroPotType,
  MacroRole,
  MacroSizing,
  defaultMacroProfile,
  serializeMacroProfile,
} from "../types/macroPostflop";

type Props = {
  initialProfile?: MacroPostflopProfile;
  onChange?: (profile: MacroPostflopProfile) => void;
};

function toggleAction(actions: MacroAction[], action: MacroAction): MacroAction[] {
  return actions.includes(action)
    ? actions.filter((a) => a !== action)
    : [...actions, action];
}

export default function MacroPostflopMatrix({ initialProfile, onChange }: Props) {
  const [profile, setProfile] = useState<MacroPostflopProfile>(
    () => initialProfile ?? defaultMacroProfile(),
  );
  const [jsonOpen, setJsonOpen] = useState(false);

  const matrix = profile.matrices[profile.potType][profile.role];

  function commit(next: MacroPostflopProfile) {
    setProfile(next);
    onChange?.(next);
  }

  function setPotType(potType: MacroPotType) {
    commit({ ...profile, potType });
  }

  function setRole(role: MacroRole) {
    commit({ ...profile, role });
  }

  function patchCell(hand: MacroHand, board: MacroBoard, patch: Partial<MacroCellRule>) {
    const prev = matrix[hand][board];
    const nextCell: MacroCellRule = { ...prev, ...patch };
    if (!nextCell.actions.includes("BET")) {
      delete nextCell.sizing;
    } else if (!nextCell.sizing) {
      nextCell.sizing = "33%";
    }

    commit({
      ...profile,
      matrices: {
        ...profile.matrices,
        [profile.potType]: {
          ...profile.matrices[profile.potType],
          [profile.role]: {
            ...matrix,
            [hand]: {
              ...matrix[hand],
              [board]: nextCell,
            },
          },
        },
      },
    });
  }

  function onToggleAction(hand: MacroHand, board: MacroBoard, action: MacroAction) {
    const prev = matrix[hand][board];
    patchCell(hand, board, { actions: toggleAction(prev.actions, action) });
  }

  function onSizing(hand: MacroHand, board: MacroBoard, sizing: MacroSizing) {
    patchCell(hand, board, { sizing });
  }

  const preview = useMemo(() => serializeMacroProfile(profile), [profile]);
  const jsonText = useMemo(() => JSON.stringify(preview, null, 2), [preview]);

  const potLabel = MACRO_POT_TYPES.find((p) => p.id === profile.potType)?.label ?? profile.potType;
  const roleLabel = MACRO_ROLES.find((r) => r.id === profile.role)?.label ?? profile.role;

  return (
    <div className="mpm">
      <header className="mpm-header">
        <div>
          <p className="mpm-eyebrow">Макро-постфлоп</p>
          <h2>Матрица стратегии</h2>
          <p className="mpm-lead">
            Глобальные правила по текстуре борда и силе руки — без дерева на каждую комбо.
          </p>
        </div>
        <p className="mpm-context">
          <strong>{potLabel}</strong>
          <span>·</span>
          <em>{roleLabel}</em>
        </p>
      </header>

      <div className="mpm-toggles">
        <div className="mpm-toggle-block">
          <span className="mpm-toggle-label">Тип банка</span>
          <div className="mpm-toggle-row" role="group" aria-label="Тип банка">
            {MACRO_POT_TYPES.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.tip}
                className={`mpm-toggle${profile.potType === p.id ? " is-active" : ""}`}
                onClick={() => setPotType(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mpm-toggle-block">
          <span className="mpm-toggle-label">Префлоп-роль</span>
          <div className="mpm-toggle-row" role="group" aria-label="Префлоп-роль">
            {MACRO_ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                title={r.tip}
                className={`mpm-toggle${profile.role === r.id ? " is-active" : ""}`}
                onClick={() => setRole(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3×4 macro matrix */}
      <div className="mpm-table-wrap">
        <table className="mpm-table">
          <thead>
            <tr>
              <th className="mpm-corner">
                <span>Рука ↓ / Борд →</span>
              </th>
              {MACRO_BOARDS.map((b) => (
                <th key={b.id}>
                  <strong>{b.label}</strong>
                  <em>{b.hint}</em>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MACRO_HANDS.map((hand) => (
              <tr key={hand.id}>
                <th scope="row">
                  <strong>{hand.label}</strong>
                  <em>{hand.hint}</em>
                </th>
                {MACRO_BOARDS.map((board) => {
                  const cell = matrix[hand.id][board.id];
                  const betOn = cell.actions.includes("BET");
                  return (
                    <td key={board.id}>
                      <div className="mpm-cell">
                        <div
                          className="mpm-actions"
                          role="group"
                          aria-label={`${hand.label} on ${board.label}`}
                        >
                          {MACRO_ACTIONS.map((act) => {
                            const on = cell.actions.includes(act.id);
                            return (
                              <button
                                key={act.id}
                                type="button"
                                className={`mpm-act tone-${act.tone}${on ? " is-active" : ""}`}
                                aria-pressed={on}
                                onClick={() => onToggleAction(hand.id, board.id, act.id)}
                              >
                                {act.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className={`mpm-sizing${betOn ? " is-open" : ""}`}>
                          {betOn ? (
                            <select
                              aria-label="Сайзинг бета"
                              value={cell.sizing ?? "33%"}
                              onChange={(e) =>
                                onSizing(hand.id, board.id, e.target.value as MacroSizing)
                              }
                            >
                              {MACRO_SIZINGS.map((s) => (
                                <option key={s} value={s}>
                                  {s} банка
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="mpm-sizing-placeholder">сайзинг</span>
                          )}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mpm-json">
        <button
          type="button"
          className="mpm-json-toggle"
          aria-expanded={jsonOpen}
          onClick={() => setJsonOpen((v) => !v)}
        >
          <span>JSON профиля</span>
          <em>{jsonOpen ? "Скрыть" : "Показать"}</em>
        </button>
        {jsonOpen && (
          <pre className="mpm-json-body" tabIndex={0}>
            {jsonText}
          </pre>
        )}
      </section>
    </div>
  );
}
