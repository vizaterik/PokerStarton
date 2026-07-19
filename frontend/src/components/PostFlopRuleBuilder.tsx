import { useMemo, useState } from "react";
import {
  BET_SIZINGS,
  BOARD_TEXTURES,
  BetSizing,
  BoardTexture,
  HandCategory,
  HAND_CATEGORIES,
  HandCategoryRule,
  POSTFLOP_ACTIONS,
  POSTFLOP_STREETS,
  PostflopAction,
  PostflopRuleBranch,
  PostflopRuleSet,
  PostflopStreet,
  PostflopStrategyTree,
  PREFLOP_ROLES,
  PreflopRole,
  branchSummaryLabel,
  cloneRuleSet,
  defaultPostflopTree,
  emptyPostflopRuleSet,
  newBranchId,
} from "../types/postflop";

type Props = {
  initialTree?: PostflopStrategyTree;
  onChange?: (tree: PostflopStrategyTree) => void;
};

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function serializeRuleSet(ruleSet: PostflopRuleSet): PostflopRuleSet {
  return {
    street: ruleSet.street,
    role: ruleSet.role,
    boardTexture: [...ruleSet.boardTexture],
    rules: ruleSet.rules
      .filter((r) => r.allowedActions.length > 0)
      .map((r) => {
        const row: HandCategoryRule = {
          handCategory: r.handCategory,
          allowedActions: [...r.allowedActions],
        };
        if (r.allowedActions.includes("BET") && r.sizing) {
          row.sizing = r.sizing;
        }
        return row;
      }),
  };
}

function serializeTree(tree: PostflopStrategyTree) {
  return {
    branches: tree.branches.map((b) => ({
      id: b.id,
      name: b.name,
      ...serializeRuleSet(b.ruleSet),
    })),
  };
}

export default function PostFlopRuleBuilder({ initialTree, onChange }: Props) {
  const [tree, setTree] = useState<PostflopStrategyTree>(
    () => initialTree ?? defaultPostflopTree(),
  );
  const [activeId, setActiveId] = useState(
    () => (initialTree ?? defaultPostflopTree()).branches[0]?.id ?? "",
  );
  const [jsonOpen, setJsonOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const active = tree.branches.find((b) => b.id === activeId) ?? tree.branches[0];
  const ruleSet = active?.ruleSet ?? emptyPostflopRuleSet();

  function commitTree(next: PostflopStrategyTree, nextActiveId?: string) {
    setTree(next);
    if (nextActiveId) setActiveId(nextActiveId);
    onChange?.(next);
  }

  function patchActive(patch: Partial<PostflopRuleSet>) {
    if (!active) return;
    commitTree({
      branches: tree.branches.map((b) =>
        b.id === active.id ? { ...b, ruleSet: { ...b.ruleSet, ...patch } } : b,
      ),
    });
  }

  function updateActiveRuleSet(nextSet: PostflopRuleSet) {
    if (!active) return;
    commitTree({
      branches: tree.branches.map((b) =>
        b.id === active.id ? { ...b, ruleSet: nextSet } : b,
      ),
    });
  }

  function setStreet(street: PostflopStreet) {
    patchActive({ street });
  }

  function setRole(role: PreflopRole) {
    patchActive({ role });
  }

  function toggleTexture(id: BoardTexture) {
    patchActive({ boardTexture: toggleInList(ruleSet.boardTexture, id) });
  }

  function updateRule(category: HandCategory, patch: Partial<HandCategoryRule>) {
    const rules = ruleSet.rules.map((r) =>
      r.handCategory === category ? { ...r, ...patch } : r,
    );
    // Ensure category row exists
    const has = rules.some((r) => r.handCategory === category);
    const nextRules = has
      ? rules
      : [...rules, { handCategory: category, allowedActions: [], ...patch }];
    updateActiveRuleSet({ ...ruleSet, rules: nextRules });
  }

  function toggleAction(category: HandCategory, action: PostflopAction) {
    const row = ruleSet.rules.find((r) => r.handCategory === category) ?? {
      handCategory: category,
      allowedActions: [] as PostflopAction[],
    };
    const nextActions = toggleInList(row.allowedActions, action);
    const patch: Partial<HandCategoryRule> = { allowedActions: nextActions };
    if (action === "BET") {
      patch.sizing = nextActions.includes("BET") ? (row.sizing ?? "33%") : undefined;
    }
    updateRule(category, patch);
  }

  function setSizing(category: HandCategory, sizing: BetSizing) {
    updateRule(category, { sizing });
  }

  function addBranch() {
    const n = tree.branches.length + 1;
    const branch: PostflopRuleBranch = {
      id: newBranchId(),
      name: `Ветка ${n}`,
      ruleSet: emptyPostflopRuleSet(),
    };
    commitTree({ branches: [...tree.branches, branch] }, branch.id);
  }

  function duplicateBranch(id: string) {
    const src = tree.branches.find((b) => b.id === id);
    if (!src) return;
    const branch: PostflopRuleBranch = {
      id: newBranchId(),
      name: `${src.name} (копия)`,
      ruleSet: cloneRuleSet(src.ruleSet),
    };
    const idx = tree.branches.findIndex((b) => b.id === id);
    const branches = [...tree.branches];
    branches.splice(idx + 1, 0, branch);
    commitTree({ branches }, branch.id);
  }

  function deleteBranch(id: string) {
    if (tree.branches.length <= 1) return;
    const branches = tree.branches.filter((b) => b.id !== id);
    const nextActive =
      activeId === id ? (branches[0]?.id ?? "") : activeId;
    commitTree({ branches }, nextActive);
  }

  function renameBranch(id: string, name: string) {
    commitTree({
      branches: tree.branches.map((b) => (b.id === id ? { ...b, name } : b)),
    });
  }

  const preview = useMemo(() => serializeTree(tree), [tree]);
  const jsonText = useMemo(() => JSON.stringify(preview, null, 2), [preview]);

  const summary = useMemo(() => {
    if (!active) return "Нет веток";
    return branchSummaryLabel(ruleSet);
  }, [active, ruleSet]);

  if (!active) {
    return (
      <div className="pfrb">
        <p className="muted">Нет веток правил.</p>
        <button type="button" className="pfrb-reset" onClick={addBranch}>
          Создать ветку
        </button>
      </div>
    );
  }

  return (
    <div className="pfrb">
      <header className="pfrb-header">
        <div>
          <p className="pfrb-eyebrow">Постфлоп-стратегия</p>
          <h2>Ветки правил</h2>
          <p className="pfrb-summary">
            {tree.branches.length}{" "}
            {tree.branches.length === 1 ? "ветка" : "веток"} · активная: {active.name}
          </p>
        </div>
        <button type="button" className="pfrb-reset" onClick={addBranch}>
          + Новая ветка
        </button>
      </header>

      <div className="pfrb-layout">
        {/* Branch tree */}
        <aside className="pfrb-branches" aria-label="Ветки правил">
          <div className="pfrb-branches-head">
            <h3>Дерево</h3>
            <span>{tree.branches.length}</span>
          </div>
          <ul className="pfrb-branch-list">
            {tree.branches.map((b, i) => {
              const on = b.id === active.id;
              return (
                <li key={b.id} className={`pfrb-branch${on ? " is-active" : ""}`}>
                  <button
                    type="button"
                    className="pfrb-branch-main"
                    onClick={() => setActiveId(b.id)}
                  >
                    <em>#{i + 1}</em>
                    {renamingId === b.id ? (
                      <input
                        className="pfrb-branch-rename"
                        value={b.name}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => renameBranch(b.id, e.target.value)}
                        onBlur={() => setRenamingId(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setRenamingId(null);
                        }}
                      />
                    ) : (
                      <strong>{b.name}</strong>
                    )}
                    <span>{branchSummaryLabel(b.ruleSet)}</span>
                  </button>
                  <div className="pfrb-branch-actions">
                    <button
                      type="button"
                      title="Переименовать"
                      onClick={() => setRenamingId(b.id)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      title="Дублировать"
                      onClick={() => duplicateBranch(b.id)}
                    >
                      ⎘
                    </button>
                    <button
                      type="button"
                      title="Удалить"
                      disabled={tree.branches.length <= 1}
                      onClick={() => deleteBranch(b.id)}
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="pfrb-editor">
          <p className="pfrb-active-line">{summary}</p>

          <section className="pfrb-section" aria-labelledby="pfrb-situation">
            <div className="pfrb-section-head">
              <span className="pfrb-step">01</span>
              <div>
                <h3 id="pfrb-situation">Ситуация ветки</h3>
                <p>Улица, префлоп-роль и фильтры текстуры борда для этой ветки.</p>
              </div>
            </div>

            <div className="pfrb-situation-grid">
              <div className="pfrb-field">
                <label htmlFor="pfrb-street">Улица</label>
                <div className="pfrb-select-wrap">
                  <select
                    id="pfrb-street"
                    value={ruleSet.street}
                    onChange={(e) => setStreet(e.target.value as PostflopStreet)}
                  >
                    {POSTFLOP_STREETS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pfrb-field">
                <span className="pfrb-label">Префлоп-роль</span>
                <div className="pfrb-toggle-row" role="group" aria-label="Префлоп-роль">
                  {PREFLOP_ROLES.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      title={r.tip}
                      className={`pfrb-toggle${ruleSet.role === r.id ? " is-active" : ""}`}
                      onClick={() => setRole(r.id)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pfrb-field pfrb-field-span">
                <span className="pfrb-label">Текстура борда</span>
                <div className="pfrb-badge-row" role="group" aria-label="Текстура борда">
                  {BOARD_TEXTURES.map((t) => {
                    const on = ruleSet.boardTexture.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`pfrb-badge${on ? " is-active" : ""}`}
                        aria-pressed={on}
                        onClick={() => toggleTexture(t.id)}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="pfrb-section" aria-labelledby="pfrb-hands">
            <div className="pfrb-section-head">
              <span className="pfrb-step">02</span>
              <div>
                <h3 id="pfrb-hands">Категории рук и стратегия</h3>
                <p>Назначь фолд / чек / колл / бет по силе руки. Бет открывает сайзинг.</p>
              </div>
            </div>

            <ul className="pfrb-hand-list">
              {HAND_CATEGORIES.map((cat) => {
                const row =
                  ruleSet.rules.find((r) => r.handCategory === cat.id) ?? {
                    handCategory: cat.id,
                    allowedActions: [] as PostflopAction[],
                  };
                const betOn = row.allowedActions.includes("BET");

                return (
                  <li key={cat.id} className="pfrb-hand-row">
                    <div className="pfrb-hand-meta">
                      <strong>{cat.label}</strong>
                      <span>{cat.hint}</span>
                    </div>

                    <div className="pfrb-hand-controls">
                      <div
                        className="pfrb-action-group"
                        role="group"
                        aria-label={`Действия: ${cat.label}`}
                      >
                        {POSTFLOP_ACTIONS.map((act) => {
                          const on = row.allowedActions.includes(act.id);
                          return (
                            <button
                              key={act.id}
                              type="button"
                              className={`pfrb-act tone-${act.tone}${on ? " is-active" : ""}`}
                              aria-pressed={on}
                              onClick={() => toggleAction(cat.id, act.id)}
                            >
                              {act.label}
                            </button>
                          );
                        })}
                      </div>

                      <div
                        className={`pfrb-sizing-slot${betOn ? " is-open" : ""}`}
                        aria-hidden={!betOn}
                      >
                        {betOn && (
                          <div className="pfrb-sizing" role="group" aria-label="Сайзинг бета">
                            <span className="pfrb-sizing-label">Сайзинг</span>
                            <div className="pfrb-sizing-options">
                              {BET_SIZINGS.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  className={`pfrb-size${row.sizing === s.id ? " is-active" : ""}`}
                                  onClick={() => setSizing(cat.id, s.id)}
                                >
                                  {s.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>

      <section className="pfrb-json">
        <button
          type="button"
          className="pfrb-json-toggle"
          aria-expanded={jsonOpen}
          onClick={() => setJsonOpen((v) => !v)}
        >
          <span>JSON всех веток</span>
          <em>{jsonOpen ? "Скрыть" : "Показать превью"}</em>
        </button>
        {jsonOpen && (
          <pre className="pfrb-json-body" tabIndex={0}>
            {jsonText}
          </pre>
        )}
      </section>
    </div>
  );
}
