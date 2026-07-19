/**
 * Быстрые проверки валидации очереди позиций (без рантайм-раннера).
 * Импортируй в консоли или в тестах: assertSpotFilterInvariants().
 */
import {
  availableHeroPositions,
  buildDisabledMaps,
  isFilterReady,
  positionsForModule,
  resolveStrategyModule,
  validateRaiseDefensePair,
} from "./index";

/** Прогоняет ключевые инварианты ТЗ; бросает Error при нарушении. */
export function assertSpotFilterInvariants(): void {
  const cash = resolveStrategyModule("cash", "6-max");
  const spins = resolveStrategyModule("spins", "3-max");
  const mtt = resolveStrategyModule("mtt", "9-max");

  // 1) Наборы позиций по модулю
  if (positionsForModule(cash).join(",") !== "UTG,MP,CO,BU,SB,BB") {
    throw new Error("cash_6max positions mismatch");
  }
  if (positionsForModule(spins).join(",") !== "BU,SB,BB") {
    throw new Error("spins_3max positions mismatch");
  }
  if (positionsForModule(mtt).join(",") !== "UTG,UTG+1,MP,MP+2,CO,BU,SB,BB") {
    throw new Error("mtt_9max positions mismatch");
  }

  // 2) RFI: BB недоступен
  const rfiHeroes = availableHeroPositions(cash, {
    situationKind: "RFI",
    raiserPosition: null,
  });
  if (rfiHeroes.includes("BB")) throw new Error("RFI must not include BB");

  // 3) vs Open UTG → герой только после UTG
  const vsUtg = availableHeroPositions(cash, {
    situationKind: "IP_OOP_DEFENSE",
    raiserPosition: "UTG",
  });
  if (vsUtg.includes("UTG") || !vsUtg.includes("BU") || !vsUtg.includes("BB")) {
    throw new Error("vs UTG hero list invalid");
  }

  // 4) Абсурд: рейз BU + герой CO
  const absurd = validateRaiseDefensePair(cash, "BU", "CO");
  if (!absurd) throw new Error("BU raise vs CO hero must be invalid");

  // 5) Фильтр не ready без героя
  if (
    isFilterReady(cash, {
      situationKind: "RFI",
      raiserPosition: null,
      heroPosition: null,
    })
  ) {
    throw new Error("filter must not be ready without hero");
  }

  // 6) Disabled maps: CO disabled when raiser is BU
  const maps = buildDisabledMaps(cash, {
    situationKind: "IP_OOP_DEFENSE",
    raiserPosition: "BU",
    heroPosition: null,
  });
  if (!maps.heroes.CO || !maps.heroes.MP) {
    throw new Error("CO/MP must be disabled vs BU open");
  }
}
