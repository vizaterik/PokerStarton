/** Macro postflop strategy — 3×4 global rules by board × hand strength. */

export type MacroPotType = "srp" | "threebet";
export type MacroRole = "aggressor" | "caller";

export type MacroBoard =
  | "dry"
  | "wet"
  | "high";

export type MacroHand =
  | "strong_made"
  | "medium_sdv"
  | "strong_draws"
  | "air";

export type MacroAction = "FOLD" | "CHECK" | "CALL" | "BET";
export type MacroSizing = "33%" | "50%" | "75%";

export type MacroCellRule = {
  actions: MacroAction[];
  sizing?: MacroSizing;
};

/** One matrix for a pot-type × role pair. */
export type MacroMatrix = Record<MacroHand, Record<MacroBoard, MacroCellRule>>;

export type MacroPostflopProfile = {
  potType: MacroPotType;
  role: MacroRole;
  matrices: Record<MacroPotType, Record<MacroRole, MacroMatrix>>;
};

export const MACRO_POT_TYPES: { id: MacroPotType; label: string; tip: string }[] = [
  { id: "srp", label: "Одиночный рейз (SRP)", tip: "Один рейз префлоп" },
  { id: "threebet", label: "3-бет банки", tip: "Банки после 3-бета" },
];

export const MACRO_ROLES: { id: MacroRole; label: string; tip: string }[] = [
  { id: "aggressor", label: "Агрессор (C-bet споты)", tip: "Ты последний рейзер префлоп" },
  { id: "caller", label: "Коллер (защита)", tip: "Защищаешься vs C-bet / bet" },
];

export const MACRO_BOARDS: { id: MacroBoard; label: string; hint: string }[] = [
  {
    id: "dry",
    label: "Сухие борды",
    hint: "Без флеш-дро, несвязанные, парные",
  },
  {
    id: "wet",
    label: "Мокрые / динамичные",
    hint: "Много стрит/флеш-дро, связанные",
  },
  {
    id: "high",
    label: "A-high / K-high",
    hint: "Высокие карты на флопе",
  },
];

export const MACRO_HANDS: { id: MacroHand; label: string; hint: string }[] = [
  {
    id: "strong_made",
    label: "Сильные готовые",
    hint: "Сеты, две пары, хорошие топ-пары",
  },
  {
    id: "medium_sdv",
    label: "Средние / SDV",
    hint: "Средние/нижние пары, слабые топ-пары",
  },
  {
    id: "strong_draws",
    label: "Сильные дро",
    hint: "Флеш-дро, OESD, комбо-дро",
  },
  {
    id: "air",
    label: "Воздух / треш",
    hint: "Без пары, слабые бэкдоры",
  },
];

export const MACRO_ACTIONS: {
  id: MacroAction;
  label: string;
  tone: "fold" | "check" | "call" | "bet";
}[] = [
  { id: "FOLD", label: "Фолд", tone: "fold" },
  { id: "CHECK", label: "Чек", tone: "check" },
  { id: "CALL", label: "Колл", tone: "call" },
  { id: "BET", label: "Бет", tone: "bet" },
];

export const MACRO_SIZINGS: MacroSizing[] = ["33%", "50%", "75%"];

function cell(actions: MacroAction[], sizing?: MacroSizing): MacroCellRule {
  return sizing ? { actions, sizing } : { actions };
}

function emptyMatrix(): MacroMatrix {
  const row = (): Record<MacroBoard, MacroCellRule> => ({
    dry: cell([]),
    wet: cell([]),
    high: cell([]),
  });
  return {
    strong_made: row(),
    medium_sdv: row(),
    strong_draws: row(),
    air: row(),
  };
}

function aggressorSrp(): MacroMatrix {
  return {
    strong_made: {
      dry: cell(["BET"], "50%"),
      wet: cell(["BET"], "75%"),
      high: cell(["BET"], "33%"),
    },
    medium_sdv: {
      dry: cell(["BET", "CHECK"], "33%"),
      wet: cell(["CHECK"]),
      high: cell(["CHECK", "BET"], "33%"),
    },
    strong_draws: {
      dry: cell(["BET"], "33%"),
      wet: cell(["BET"], "75%"),
      high: cell(["BET", "CHECK"], "33%"),
    },
    air: {
      dry: cell(["BET", "CHECK"], "33%"),
      wet: cell(["CHECK"]),
      high: cell(["CHECK", "FOLD"]),
    },
  };
}

function callerSrp(): MacroMatrix {
  return {
    strong_made: {
      dry: cell(["CALL", "BET"], "75%"),
      wet: cell(["CALL", "BET"], "75%"),
      high: cell(["CALL"]),
    },
    medium_sdv: {
      dry: cell(["CALL"]),
      wet: cell(["CALL", "FOLD"]),
      high: cell(["CALL", "FOLD"]),
    },
    strong_draws: {
      dry: cell(["CALL", "BET"], "75%"),
      wet: cell(["CALL"]),
      high: cell(["CALL"]),
    },
    air: {
      dry: cell(["FOLD", "CHECK"]),
      wet: cell(["FOLD"]),
      high: cell(["FOLD"]),
    },
  };
}

function aggressor3bet(): MacroMatrix {
  return {
    strong_made: {
      dry: cell(["BET"], "75%"),
      wet: cell(["BET"], "75%"),
      high: cell(["BET"], "50%"),
    },
    medium_sdv: {
      dry: cell(["CHECK", "BET"], "33%"),
      wet: cell(["CHECK"]),
      high: cell(["CHECK"]),
    },
    strong_draws: {
      dry: cell(["BET"], "50%"),
      wet: cell(["BET"], "75%"),
      high: cell(["BET", "CHECK"], "50%"),
    },
    air: {
      dry: cell(["CHECK", "BET"], "33%"),
      wet: cell(["CHECK"]),
      high: cell(["CHECK"]),
    },
  };
}

function caller3bet(): MacroMatrix {
  return {
    strong_made: {
      dry: cell(["CALL", "BET"], "75%"),
      wet: cell(["CALL"]),
      high: cell(["CALL"]),
    },
    medium_sdv: {
      dry: cell(["CALL", "FOLD"]),
      wet: cell(["FOLD"]),
      high: cell(["CALL", "FOLD"]),
    },
    strong_draws: {
      dry: cell(["CALL"]),
      wet: cell(["CALL", "BET"], "75%"),
      high: cell(["CALL"]),
    },
    air: {
      dry: cell(["FOLD"]),
      wet: cell(["FOLD"]),
      high: cell(["FOLD"]),
    },
  };
}

export function defaultMacroProfile(): MacroPostflopProfile {
  return {
    potType: "srp",
    role: "aggressor",
    matrices: {
      srp: {
        aggressor: aggressorSrp(),
        caller: callerSrp(),
      },
      threebet: {
        aggressor: aggressor3bet(),
        caller: caller3bet(),
      },
    },
  };
}

export function serializeMacroProfile(profile: MacroPostflopProfile) {
  const matrix = profile.matrices[profile.potType][profile.role];
  const rules: {
    board: MacroBoard;
    hand: MacroHand;
    actions: MacroAction[];
    sizing?: MacroSizing;
  }[] = [];

  for (const hand of MACRO_HANDS) {
    for (const board of MACRO_BOARDS) {
      const cellRule = matrix[hand.id][board.id];
      if (cellRule.actions.length === 0) continue;
      rules.push({
        board: board.id,
        hand: hand.id,
        actions: [...cellRule.actions],
        ...(cellRule.actions.includes("BET") && cellRule.sizing
          ? { sizing: cellRule.sizing }
          : {}),
      });
    }
  }

  return {
    potType: profile.potType,
    role: profile.role,
    rules,
    matrices: profile.matrices,
  };
}
