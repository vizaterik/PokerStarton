import { createSpot, listSpots, upsertCells } from "../api/client";
import { shortBranchLabel } from "./branchLabel";
import { Position, SpotKey } from "../types/strategy";
import { matrixFromRanges, matrixToPayload, RangeBuildSpec } from "./rangeNotation";

export type RangeSpec = RangeBuildSpec;

export type StrategyPreset = {
  id: string;
  name: string;
  tag: string;
  description: string;
  /** spot → position → raise/call/mix ranges (6-max ~100bb) */
  chart: Partial<Record<SpotKey, Partial<Record<Position, RangeSpec>>>>;
};

/**
 * Ready-made 6-max NLHE ~100bb charts.
 * Every relevant seat is filled for RFI / vs Open / vs 3-bet / vs 4-bet / Squeeze / ISO.
 * Frequencies follow common solver tendencies (not a full GTO export).
 */
export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: "balanced",
    name: "Сбалансированный",
    tag: "ABC",
    description:
      "Базовый 6-max ~100bb: UTG ~15%, CO ~27%, BTN ~45%. Нормальная защита BB и миксы 3/4-бета.",
    chart: {
      rfi: {
        UTG: {
          raise: "77+, ATs+, KQs, AJo+",
          raiseFold: "66:50, 55:30, A9s:45, KJs:50, QJs:40, JTs:35, T9s:25, ATo:40, KQo:55",
        },
        MP: {
          raise: "66+, A9s+, KTs+, QTs+, JTs, ATo+, KQo",
          raiseFold: "55:55, 44:35, A8s:45, K9s:40, Q9s:30, T9s:45, 98s:35, A9o:40, KJo:45, QJo:35",
        },
        CO: {
          raise: "33+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, A9o+, KTo+, QTo+, JTo",
          raiseFold:
            "22:55, K8s:50, Q8s:40, J8s:35, T8s:50, 97s:45, 76s:50, 65s:40, A8o:50, A7o:35, K9o:45, Q9o:40",
        },
        BTN: {
          raise:
            "22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, A2o+, K9o+, Q9o+, J9o+, T9o",
          raiseFold:
            "K4s:50, K3s:40, K2s:30, Q7s:50, Q6s:40, J7s:45, T7s:50, 96s:45, 86s:45, 75s:40, 54s:45, K8o:55, Q8o:50, J8o:45, T8o:45, 98o:40",
        },
        SB: {
          raise: "22+, A2s+, K7s+, Q9s+, J9s+, T9s, 98s, 87s, A8o+, KTo+, QTo+, JTo",
          raiseFold:
            "K6s:50, K5s:40, Q8s:45, J8s:40, T8s:45, 97s:40, 76s:45, 65s:35, A7o:45, A6o:35, A5o:30, K9o:50, Q9o:40",
        },
      },
      vs_open: {
        BB: {
          raise: "TT+, AQs+, AKo",
          call: "22-99, A2s-AJs, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, ATo+, KJo+, QJo",
          raiseCall: "99:40, AJs:50, KQs:55, AQo:40, KJs:25",
          raiseFold: "A5s:40, A4s:35, A3s:30, A2s:25, QJs:30, JTs:35, T9s:30, 98s:20",
        },
        SB: {
          raise: "JJ+, AQs+, AKo",
          call: "55-TT, A2s-AJs, KTs+, QTs+, JTs, ATo+, KQo",
          raiseCall: "TT:40, AJs:45, KQs:50, AQo:35",
          raiseFold: "A5s:45, A4s:40, A3s:30, KJs:35, QJs:30, JTs:25",
        },
        BTN: {
          raise: "JJ+, AKs, AKo",
          call: "66-TT, ATs+, KQs, AJo+",
          raiseCall: "TT:45, AQs:50, KJs:35, AQo:40",
          raiseFold: "A5s:40, A4s:35, A3s:25, 99:30, KQs:20",
        },
        CO: {
          raise: "QQ+, AKs, AKo",
          call: "88-JJ, AQs+, KQs, AQo",
          raiseCall: "JJ:40, AQs:45, AQo:35",
          raiseFold: "A5s:35, A4s:25, TT:25",
        },
        MP: {
          raise: "QQ+, AKs, AKo",
          call: "99-JJ, AQs+, KQs",
          raiseCall: "JJ:35, AQs:40, AKo:25",
          raiseFold: "A5s:30, TT:20",
        },
        UTG: {
          raise: "KK+, AKo",
          call: "TT-QQ, AKs",
          raiseCall: "QQ:40, AKs:45, AKo:35",
        },
      },
      vs_3bet: {
        BTN: {
          raise: "KK+, AKs",
          call: "TT-QQ, AQs, AKo",
          raiseCall: "QQ:45, AKo:40, AQs:35, JJ:25",
          raiseFold: "A5s:45, A4s:40, A3s:30, KQs:35, 99:25",
        },
        CO: {
          raise: "KK+, AKs",
          call: "JJ-QQ, AQs, AKo",
          raiseCall: "QQ:40, AKo:35, AQs:30",
          raiseFold: "A5s:40, A4s:30, TT:25",
        },
        SB: {
          raise: "KK+, AKs",
          call: "JJ-QQ, AQs+, AKo",
          raiseCall: "QQ:45, AKo:40",
          raiseFold: "A5s:35, A4s:25",
        },
        MP: {
          raise: "KK+",
          call: "QQ, AKs, AKo",
          raiseCall: "QQ:35, AKs:45, AKo:40",
          raiseFold: "A5s:30, JJ:15",
        },
        UTG: {
          raise: "KK+",
          call: "QQ, AKs, AKo",
          raiseCall: "AKs:40, AKo:35, QQ:25",
        },
      },
      vs_4bet: {
        BTN: {
          raise: "KK+",
          call: "QQ, AKs, AKo",
          raiseCall: "QQ:30, AKs:45, AKo:40",
        },
        CO: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:25, AKs:40, AKo:35",
        },
        SB: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:20, AKo:30",
        },
        MP: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:15",
        },
        UTG: {
          raise: "AA",
          call: "KK, AKs, AKo",
          raiseCall: "KK:40, AKs:35",
        },
        BB: {
          raise: "KK+",
          call: "QQ, AKs, AKo",
          raiseCall: "QQ:25, AKs:40, AKo:35",
        },
      },
      squeeze: {
        BB: {
          raise: "JJ+, AQs+, AKo",
          raiseFold: "TT:45, AJs:40, KQs:35, A5s:35, A4s:30, AQo:35",
        },
        SB: {
          raise: "QQ+, AKs, AKo",
          raiseFold: "JJ:45, AQs:40, A5s:35, A4s:25, AQo:35",
        },
        BTN: {
          raise: "QQ+, AKs, AKo",
          raiseFold: "JJ:50, AQs:45, A5s:40, A4s:30, AQo:40",
        },
        CO: {
          raise: "QQ+, AKs, AKo",
          raiseFold: "JJ:40, AQs:35, A5s:30",
        },
        MP: {
          raise: "KK+, AKs",
          raiseFold: "QQ:40, AKo:35, AQs:25",
        },
      },
      iso: {
        BB: {
          raise: "44+, A8s+, K9s+, Q9s+, J9s+, T8s+, 98s, A9o+, KTo+, QTo+, JTo",
          raiseFold: "33:50, A7s:45, A5s:40, K8s:40, Q8s:35, T7s:40, 97s:40, 87s:45, A8o:40",
        },
        SB: {
          raise: "55+, A8s+, K9s+, Q9s+, J9s+, T9s, A9o+, KTo+, QJo",
          raiseFold: "44:45, A7s:40, K8s:35, 98s:40, A8o:35",
        },
        BTN: {
          raise: "33+, A7s+, K8s+, Q8s+, J8s+, T8s+, 97s+, 87s, A8o+, K9o+, QTo+, JTo",
          raiseFold: "22:50, A6s:45, A5s:40, K7s:35, 76s:45, A7o:40",
        },
        CO: {
          raise: "55+, A8s+, K9s+, Q9s+, J9s+, T9s, A9o+, KTo+, QJo",
          raiseFold: "44:40, A7s:35, 98s:35, A8o:30",
        },
        MP: {
          raise: "66+, A9s+, KTs+, QTs+, JTs, ATo+, KJo+",
          raiseFold: "55:40, A8s:35, T9s:30, A9o:30",
        },
        UTG: {
          raise: "77+, ATs+, KJs+, QJs, AJo+, KQo",
          raiseFold: "66:35, A9s:30, ATo:25",
        },
      },
    },
  },
  {
    id: "tag",
    name: "Тайтово-агрессивный",
    tag: "TAG",
    description:
      "Уже RFI (UTG ~12–14%, BTN ~38%), value-heavy 3-беты, меньше спекулятивных коллов. Стабильный кэш-стиль.",
    chart: {
      rfi: {
        UTG: {
          raise: "88+, ATs+, KQs, AJo+",
          raiseFold: "77:55, 66:30, A9s:35, KJs:40, QJs:30, ATo:30, KQo:45",
        },
        MP: {
          raise: "77+, A9s+, KTs+, QJs, ATo+, KQo",
          raiseFold: "66:50, 55:30, A8s:35, K9s:30, QTs:40, JTs:35, T9s:30, A9o:30, KJo:35",
        },
        CO: {
          raise: "55+, A5s+, K9s+, Q9s+, J9s+, T9s, A9o+, KTo+, QTo+, JTo",
          raiseFold: "44:50, 33:30, A4s:40, A3s:30, K8s:35, Q8s:30, T8s:40, 98s:45, 87s:35, A8o:40, K9o:35",
        },
        BTN: {
          raise: "33+, A2s+, K7s+, Q9s+, J9s+, T9s, 98s, 87s, A5o+, KTo+, QTo+, JTo",
          raiseFold:
            "22:50, K6s:45, K5s:35, Q8s:45, J8s:40, T8s:45, 97s:40, 76s:40, A4o:40, A3o:30, K9o:50, Q9o:40, J9o:35",
        },
        SB: {
          raise: "44+, A5s+, K9s+, Q9s+, J9s+, T9s, A9o+, KTo+, QJo",
          raiseFold: "33:45, A4s:40, A3s:30, K8s:35, Q8s:30, T8s:35, 98s:35, A8o:40, K9o:40",
        },
      },
      vs_open: {
        BB: {
          raise: "JJ+, AQs+, AKo",
          call: "55-TT, A8s-AJs, KTs+, QTs+, JTs, ATo+, KQo",
          raiseCall: "TT:35, AJs:40, KQs:45, AQo:30",
          raiseFold: "A5s:30, A4s:25, KJs:25, QJs:20, JTs:20",
        },
        SB: {
          raise: "JJ+, AQs+, AKo",
          call: "77-TT, A9s-AJs, KJs+, QJs, AJo+, KQo",
          raiseCall: "TT:30, AJs:35, KQs:40, AQo:25",
          raiseFold: "A5s:30, A4s:25, KTs:20",
        },
        BTN: {
          raise: "QQ+, AKs, AKo",
          call: "88-JJ, ATs+, KQs, AQo",
          raiseCall: "JJ:35, AQs:40, AQo:30",
          raiseFold: "A5s:25, TT:20",
        },
        CO: {
          raise: "QQ+, AKs, AKo",
          call: "99-JJ, AQs+, KQs",
          raiseCall: "JJ:30, AQs:35",
          raiseFold: "TT:15",
        },
        MP: {
          raise: "KK+, AKo",
          call: "TT-QQ, AKs, AQs",
          raiseCall: "QQ:35, AKs:40, AKo:30",
        },
        UTG: {
          raise: "KK+",
          call: "JJ-QQ, AKs, AKo",
          raiseCall: "QQ:30, AKs:35, AKo:25",
        },
      },
      vs_3bet: {
        BTN: {
          raise: "KK+, AKs",
          call: "JJ-QQ, AQs, AKo",
          raiseCall: "QQ:35, AKo:30, AQs:25",
          raiseFold: "A5s:30, TT:15",
        },
        CO: {
          raise: "KK+, AKs",
          call: "QQ, AQs, AKo",
          raiseCall: "QQ:30, AKo:25",
          raiseFold: "A5s:25, JJ:15",
        },
        SB: {
          raise: "KK+, AKs",
          call: "QQ, AQs+, AKo",
          raiseCall: "QQ:35, AKo:30",
          raiseFold: "A5s:20",
        },
        MP: {
          raise: "KK+",
          call: "QQ, AKs, AKo",
          raiseCall: "AKs:35, AKo:30, QQ:20",
        },
        UTG: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:15, AKs:30, AKo:25",
        },
      },
      vs_4bet: {
        BTN: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:20, AKs:35, AKo:30",
        },
        CO: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:15, AKo:25",
        },
        SB: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:10",
        },
        MP: {
          raise: "AA",
          call: "KK, AKs, AKo",
          raiseCall: "KK:35",
        },
        UTG: {
          raise: "AA",
          call: "KK, AKo",
          raiseCall: "AKs:25",
        },
        BB: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:15, AKo:30",
        },
      },
      squeeze: {
        BB: {
          raise: "QQ+, AKs, AKo",
          raiseFold: "JJ:40, AQs:35, A5s:25, AQo:25",
        },
        SB: {
          raise: "QQ+, AKs, AKo",
          raiseFold: "JJ:35, AQs:30, A5s:20",
        },
        BTN: {
          raise: "QQ+, AKs, AKo",
          raiseFold: "JJ:40, AQs:35, A5s:25, AQo:30",
        },
        CO: {
          raise: "KK+, AKs",
          raiseFold: "QQ:40, AKo:30",
        },
        MP: {
          raise: "KK+",
          raiseFold: "QQ:30, AKs:35, AKo:25",
        },
      },
      iso: {
        BB: {
          raise: "66+, A9s+, KTs+, QTs+, JTs, ATo+, KJo+",
          raiseFold: "55:45, A8s:40, K9s:35, Q9s:30, T9s:40, A9o:35",
        },
        SB: {
          raise: "77+, A9s+, KTs+, QJs, ATo+, KQo",
          raiseFold: "66:40, A8s:35, K9s:30, A9o:30",
        },
        BTN: {
          raise: "55+, A8s+, K9s+, Q9s+, J9s+, T9s, A9o+, KTo+, QJo",
          raiseFold: "44:40, A7s:35, K8s:30, 98s:35, A8o:30",
        },
        CO: {
          raise: "66+, A9s+, KTs+, QTs+, ATo+, KJo+",
          raiseFold: "55:35, A8s:30, T9s:30",
        },
        MP: {
          raise: "77+, ATs+, KJs+, QJs, AJo+, KQo",
          raiseFold: "66:35, A9s:30, ATo:25",
        },
        UTG: {
          raise: "88+, ATs+, KQs, AJo+",
          raiseFold: "77:30, A9s:25",
        },
      },
    },
  },
  {
    id: "lag",
    name: "Лузово-агрессивный",
    tag: "LAG",
    description:
      "Широкий RFI (UTG ~18%, BTN ~50%+), много 3-бетов и сквизов. Нужен хороший постфлоп и дисциплина.",
    chart: {
      rfi: {
        UTG: {
          raise: "66+, A9s+, KTs+, QTs+, JTs, ATo+, KQo",
          raiseFold:
            "55:50, 44:30, A8s:50, K9s:40, Q9s:35, T9s:50, 98s:45, 87s:35, A9o:45, KJo:50, QJo:40",
        },
        MP: {
          raise: "44+, A5s+, K9s+, Q9s+, J9s+, T9s, 98s, A9o+, KTo+, QJo",
          raiseFold:
            "33:50, 22:30, A4s:45, A3s:35, K8s:45, Q8s:40, J8s:35, T8s:50, 97s:45, 87s:50, 76s:40, A8o:45, K9o:40, QTo:35",
        },
        CO: {
          raise:
            "22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, A5o+, K9o+, Q9o+, J9o+, T9o",
          raiseFold:
            "K5s:50, K4s:40, Q7s:45, J7s:45, T7s:50, 96s:50, 86s:45, 75s:45, 54s:50, A4o:45, A3o:35, K8o:50, Q8o:45, J8o:40",
        },
        BTN: {
          raise:
            "22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A2o+, K7o+, Q8o+, J8o+, T8o+, 98o",
          raiseFold:
            "Q4s:50, Q3s:40, Q2s:30, J6s:50, T6s:45, 95s:45, 85s:40, 74s:40, 64s:45, 43s:40, K6o:45, K5o:35, Q7o:50, J7o:45, T7o:45, 97o:40, 87o:35",
        },
        SB: {
          raise:
            "22+, A2s+, K4s+, Q7s+, J8s+, T8s+, 97s+, 87s, 76s, A4o+, K8o+, Q9o+, J9o+, T9o",
          raiseFold:
            "K3s:50, K2s:40, Q6s:50, Q5s:40, J7s:45, T7s:45, 96s:45, 86s:40, 65s:45, 54s:40, A3o:40, A2o:30, K7o:45, Q8o:45, J8o:40",
        },
      },
      vs_open: {
        BB: {
          raise: "99+, AJs+, KQs, AQo+",
          call:
            "22-88, A2s-ATs, K7s+, Q8s+, J8s+, T7s+, 97s+, 87s, 76s, 65s, 54s, A8o+, KTo+, QTo+, JTo",
          raiseCall: "88:50, ATs:55, KJs:50, QJs:45, AJo:45, KQo:40",
          raiseFold: "A5s:50, A4s:45, A3s:40, A2s:35, KTs:40, QTs:35, JTs:40, T9s:40, 98s:35",
        },
        SB: {
          raise: "TT+, AJs+, AQo+",
          call: "33-99, A2s-ATs, K9s+, Q9s+, J9s+, T9s, 98s, A9o+, KJo+",
          raiseCall: "99:45, ATs:50, KQs:55, AJo:40",
          raiseFold: "A5s:55, A4s:50, A3s:40, KJs:45, QJs:40, JTs:40",
        },
        BTN: {
          raise: "TT+, AQs+, AKo",
          call: "44-99, A8s+, KTs+, QTs+, JTs, ATo+, KQo",
          raiseCall: "99:50, AJs:55, KQs:50, AQo:45",
          raiseFold: "A5s:50, A4s:45, A3s:35, KJs:45, QJs:40, 88:35",
        },
        CO: {
          raise: "JJ+, AQs+, AKo",
          call: "66-TT, ATs+, KQs, AJo+",
          raiseCall: "TT:45, AJs:50, AQo:40",
          raiseFold: "A5s:45, A4s:40, 99:30",
        },
        MP: {
          raise: "JJ+, AQs+, AKo",
          call: "77-TT, ATs+, KQs, AQo",
          raiseCall: "TT:40, AJs:45, AKo:30",
          raiseFold: "A5s:40, 99:25",
        },
        UTG: {
          raise: "QQ+, AKs, AKo",
          call: "TT-JJ, AQs, KQs",
          raiseCall: "JJ:40, AQs:45, AKo:35",
          raiseFold: "A5s:30",
        },
      },
      vs_3bet: {
        BTN: {
          raise: "KK+, AKs",
          call: "99-QQ, AQs, AKo, KQs",
          raiseCall: "QQ:50, JJ:35, AKo:45, AQs:40",
          raiseFold: "A5s:55, A4s:50, A3s:40, KJs:40, QJs:35, T9s:30, 88:25",
        },
        CO: {
          raise: "KK+, AKs",
          call: "TT-QQ, AQs, AKo",
          raiseCall: "QQ:45, AKo:40, AQs:35",
          raiseFold: "A5s:50, A4s:40, 99:30",
        },
        SB: {
          raise: "KK+, AKs",
          call: "TT-QQ, AQs+, AKo",
          raiseCall: "QQ:50, AKo:45",
          raiseFold: "A5s:45, A4s:35",
        },
        MP: {
          raise: "KK+",
          call: "JJ-QQ, AKs, AKo",
          raiseCall: "QQ:40, AKs:50, AKo:45",
          raiseFold: "A5s:40, TT:20",
        },
        UTG: {
          raise: "KK+",
          call: "QQ, AKs, AKo",
          raiseCall: "AKs:45, AKo:40, QQ:30",
          raiseFold: "A5s:30",
        },
      },
      vs_4bet: {
        BTN: {
          raise: "KK+",
          call: "QQ, AKs, AKo",
          raiseCall: "QQ:35, AKs:50, AKo:45",
          raiseFold: "JJ:20, A5s:25",
        },
        CO: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:30, AKs:45, AKo:40",
          raiseFold: "A5s:20",
        },
        SB: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:25, AKo:35",
        },
        MP: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:20",
        },
        UTG: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:15",
        },
        BB: {
          raise: "KK+",
          call: "QQ, AKs, AKo",
          raiseCall: "QQ:30, AKs:45, AKo:40",
          raiseFold: "JJ:15, A5s:20",
        },
      },
      squeeze: {
        BB: {
          raise: "TT+, AJs+, AQo+",
          raiseFold: "99:50, ATs:45, KQs:45, A5s:45, A4s:40, A3s:35, KJs:40, AJo:40",
        },
        SB: {
          raise: "JJ+, AQs+, AKo",
          raiseFold: "TT:50, AJs:45, A5s:45, A4s:40, AQo:40",
        },
        BTN: {
          raise: "JJ+, AQs+, AKo",
          raiseFold: "TT:55, AJs:50, A5s:50, A4s:45, KQs:40, AQo:45",
        },
        CO: {
          raise: "QQ+, AKs, AKo",
          raiseFold: "JJ:50, AQs:45, A5s:40, AQo:35",
        },
        MP: {
          raise: "QQ+, AKs, AKo",
          raiseFold: "JJ:40, AQs:35, A5s:30",
        },
      },
      iso: {
        BB: {
          raise: "33+, A7s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, A9o+, KTo+, QTo+, JTo",
          raiseFold: "22:55, A6s:50, A5s:45, K8s:45, Q8s:40, J8s:40, T7s:45, 97s:45, 76s:45, A8o:45",
        },
        SB: {
          raise: "44+, A8s+, K9s+, Q9s+, J9s+, T9s, 98s, A9o+, KTo+, QJo",
          raiseFold: "33:50, A7s:45, K8s:40, T8s:45, 87s:40, A8o:40",
        },
        BTN: {
          raise: "22+, A5s+, K8s+, Q8s+, J8s+, T8s+, 97s+, 87s, A8o+, K9o+, QTo+, JTo",
          raiseFold: "A4s:50, A3s:45, K7s:40, Q7s:35, 76s:50, A7o:40",
        },
        CO: {
          raise: "33+, A7s+, K8s+, Q9s+, J9s+, T9s, 98s, A8o+, K9o+, QTo+",
          raiseFold: "22:45, A6s:40, A5s:35, 87s:40, A7o:35",
        },
        MP: {
          raise: "44+, A8s+, K9s+, Q9s+, J9s+, T9s, A9o+, KTo+, QJo",
          raiseFold: "33:45, A7s:40, 98s:35, A8o:35",
        },
        UTG: {
          raise: "55+, A9s+, KTs+, QTs+, ATo+, KJo+",
          raiseFold: "44:40, A8s:35, T9s:30",
        },
      },
    },
  },
  {
    id: "nit",
    name: "Нитовый",
    tag: "NIT",
    description:
      "Очень узко и value-first (UTG ~8–10%, BTN ~28%). Меньше дисперсии — для новичков и жёстких столов.",
    chart: {
      rfi: {
        UTG: {
          raise: "JJ+, AQs+, AKo",
          raiseFold: "TT:55, AJs:40, KQs:30, AQo:45",
        },
        MP: {
          raise: "TT+, AJs+, KQs, AQo+",
          raiseFold: "99:50, ATs:40, KJs:30, QJs:25, AJo:35, KQo:30",
        },
        CO: {
          raise: "99+, ATs+, KJs+, QJs, AJo+, KQo",
          raiseFold: "88:50, 77:30, A9s:40, KTs:40, QTs:30, JTs:35, ATo:40, KJo:30",
        },
        BTN: {
          raise: "77+, A9s+, KTs+, QTs+, JTs, ATo+, KJo+",
          raiseFold: "66:50, 55:30, A8s:40, K9s:30, Q9s:25, T9s:35, A9o:40, KTo:30",
        },
        SB: {
          raise: "88+, ATs+, KJs+, QJs, AJo+, KQo",
          raiseFold: "77:45, A9s:35, KTs:30, QTs:25, JTs:30, ATo:30",
        },
      },
      vs_open: {
        BB: {
          raise: "QQ+, AKs, AKo",
          call: "99-JJ, ATs+, KQs, AJo+",
          raiseCall: "JJ:30, AQs:35, AQo:20",
        },
        SB: {
          raise: "QQ+, AKs, AKo",
          call: "TT-JJ, AQs+, KQs",
          raiseCall: "JJ:25, AQs:30",
        },
        BTN: {
          raise: "KK+",
          call: "TT-QQ, AKs, AKo",
          raiseCall: "QQ:30, AKs:35, AKo:30",
        },
        CO: {
          raise: "KK+",
          call: "JJ-QQ, AKs",
          raiseCall: "QQ:25, AKs:30, AKo:25",
        },
        MP: {
          raise: "KK+",
          call: "QQ, AKs, AKo",
          raiseCall: "QQ:20, AKs:25",
        },
        UTG: {
          raise: "AA",
          call: "KK, AKs, AKo",
          raiseCall: "KK:35, AKs:25",
        },
      },
      vs_3bet: {
        BTN: {
          raise: "KK+",
          call: "QQ, AKs, AKo",
          raiseCall: "QQ:25, AKs:30, AKo:25",
        },
        CO: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:15, AKo:20",
        },
        SB: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:10",
        },
        MP: {
          raise: "KK+",
          call: "AKs, AKo",
        },
        UTG: {
          raise: "KK+",
          call: "AKo",
          raiseCall: "AKs:25",
        },
      },
      vs_4bet: {
        BTN: {
          raise: "KK+",
          call: "AKs, AKo",
          raiseCall: "QQ:10",
        },
        CO: {
          raise: "AA",
          call: "KK, AKs, AKo",
        },
        SB: {
          raise: "AA",
          call: "KK, AKo",
        },
        MP: {
          raise: "AA",
          call: "KK, AKo",
        },
        UTG: {
          raise: "AA",
          call: "KK",
        },
        BB: {
          raise: "AA",
          call: "KK, AKo",
          raiseCall: "AKs:20",
        },
      },
      squeeze: {
        BB: {
          raise: "QQ+, AKs, AKo",
          raiseFold: "JJ:30, AQs:25",
        },
        SB: {
          raise: "KK+, AKs",
          raiseFold: "QQ:30, AKo:25",
        },
        BTN: {
          raise: "KK+, AKs",
          raiseFold: "QQ:35, AKo:30",
        },
        CO: {
          raise: "KK+",
          raiseFold: "QQ:25, AKs:30, AKo:20",
        },
        MP: {
          raise: "KK+",
          raiseFold: "AKs:25, AKo:20",
        },
      },
      iso: {
        BB: {
          raise: "99+, ATs+, KJs+, QJs, AJo+, KQo",
          raiseFold: "88:40, A9s:30, KTs:25, ATo:25",
        },
        SB: {
          raise: "TT+, ATs+, KQs, AJo+",
          raiseFold: "99:35, A9s:25, KJs:20",
        },
        BTN: {
          raise: "88+, A9s+, KTs+, QTs+, ATo+, KJo+",
          raiseFold: "77:40, A8s:25, K9s:20",
        },
        CO: {
          raise: "99+, ATs+, KJs+, AJo+",
          raiseFold: "88:30, A9s:20",
        },
        MP: {
          raise: "TT+, ATs+, KQs, AJo+",
          raiseFold: "99:30, A9s:20",
        },
        UTG: {
          raise: "JJ+, AQs+, AKo",
          raiseFold: "TT:25, AJs:20",
        },
      },
    },
  },
];

function spotLabel(spotKey: SpotKey, hero: Position) {
  return shortBranchLabel(spotKey, hero);
}

/** Apply preset chart into an existing strategy (creates spots + fills matrices). */
export async function applyStrategyPreset(strategyId: string, preset: StrategyPreset) {
  let spots = await listSpots(strategyId);
  let sortOrder = spots.length;

  for (const [spotKey, byPos] of Object.entries(preset.chart) as [
    SpotKey,
    Partial<Record<Position, RangeSpec>>,
  ][]) {
    for (const [hero, spec] of Object.entries(byPos) as [Position, RangeSpec][]) {
      let spot = spots.find(
        (s) =>
          s.spot_key === spotKey &&
          s.hero_position === hero &&
          (s.villain_position ?? null) === null,
      );
      if (!spot) {
        spot = await createSpot(strategyId, {
          spot_key: spotKey,
          hero_position: hero,
          villain_position: null,
          label: spotLabel(spotKey, hero),
          sort_order: sortOrder,
        });
        sortOrder += 1;
        spots = [...spots, spot];
      }
      const matrix = matrixFromRanges(spec);
      await upsertCells(spot.id, matrixToPayload(matrix));
    }
  }
}
