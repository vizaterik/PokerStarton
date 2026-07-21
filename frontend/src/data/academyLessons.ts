/**
 * Контент Академии PokerStraton.
 * Курсы и модули. UI подхватывает изменения автоматически.
 */

import { DISCIPLINE_BRM_MODULES } from "./academyCourseDisciplines";

export type LessonBlock =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "callout"; title?: string; text: string; tone?: "gold" | "emerald" }
  | { type: "combo"; name: string; rank: string; cards: string[]; note?: string }
  | { type: "formula"; title: string; formula: string; note?: string }
  | { type: "grid"; items: { title: string; text: string }[] };

export type AcademyModule = {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  durationMin: number;
  blocks: LessonBlock[];
};

export type AcademyCourse = {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  lead: string;
  modules: AcademyModule[];
};

/** Курс 1 — базовое понимание покера. */
const BASICS_MODULES: AcademyModule[] = [
  {
    id: "m1-basics",
    order: 1,
    title: "Основы и комбинации",
    subtitle: "Правила Техасского Холдема и старшинство рук",
    durationMin: 5,
    blocks: [
      {
        type: "p",
        text: "Добро пожаловать в Академию PokerStraton. Этот модуль — фундамент: без него нельзя уверенно читать чарты, считать эквити и разбирать свои раздачи.",
      },
      {
        type: "h",
        text: "Как устроена раздача в Техасском Холдеме",
      },
      {
        type: "ol",
        items: [
          "Каждому игроку раздают 2 закрытые карты (hole cards).",
          "На стол выкладывают 5 общих карт: флоп (3), терн (1), ривер (1).",
          "Побеждает тот, кто соберёт старшую пятикарточную комбинацию из своих двух карт и борда.",
          "Можно использовать 0, 1 или 2 свои карты — главное сила итоговой пятёрки.",
        ],
      },
      {
        type: "callout",
        tone: "emerald",
        title: "Главное правило",
        text: "В холдеме вы играете не «двумя картами», а лучшей пятёркой. Иногда лучшая рука — это просто старшая карта на борде (play the board).",
      },
      {
        type: "h",
        text: "Старшинство комбинаций (от слабой к сильной)",
      },
      {
        type: "p",
        text: "Запомните порядок снизу вверх. На практике споры на вскрытии почти всегда решаются этой таблицей.",
      },
      {
        type: "combo",
        name: "Старшая карта",
        rank: "1 / 10",
        cards: ["Ah", "Kd", "9c", "5s", "2h"],
        note: "Нет пары и выше — побеждает самый высокий кикер.",
      },
      {
        type: "combo",
        name: "Пара",
        rank: "2 / 10",
        cards: ["Qh", "Qd", "Ac", "8s", "3h"],
        note: "Две карты одного ранга. При равных парах смотрят кикеры.",
      },
      {
        type: "combo",
        name: "Две пары",
        rank: "3 / 10",
        cards: ["Jh", "Jd", "9c", "9s", "Ah"],
        note: "Две разные пары + кикер.",
      },
      {
        type: "combo",
        name: "Сет / тройка",
        rank: "4 / 10",
        cards: ["8h", "8d", "8c", "Ks", "2h"],
        note: "Три карты одного ранга. Сет обычно = пара на руках + карта борда.",
      },
      {
        type: "combo",
        name: "Стрит",
        rank: "5 / 10",
        cards: ["9h", "8d", "7c", "6s", "5h"],
        note: "Пять карт подряд по рангу, масти разные. A-2-3-4-5 — колесо (wheel).",
      },
      {
        type: "combo",
        name: "Флеш",
        rank: "6 / 10",
        cards: ["Ah", "Jh", "8h", "6h", "3h"],
        note: "Пять карт одной масти. Старший флеш бьёт младший.",
      },
      {
        type: "combo",
        name: "Фулл-хаус",
        rank: "7 / 10",
        cards: ["Kh", "Kd", "Kc", "4s", "4h"],
        note: "Тройка + пара.",
      },
      {
        type: "combo",
        name: "Каре",
        rank: "8 / 10",
        cards: ["7h", "7d", "7c", "7s", "As"],
        note: "Четыре карты одного ранга.",
      },
      {
        type: "combo",
        name: "Стрит-флеш",
        rank: "9 / 10",
        cards: ["9s", "8s", "7s", "6s", "5s"],
        note: "Стрит одной масти.",
      },
      {
        type: "combo",
        name: "Роял-флеш",
        rank: "10 / 10",
        cards: ["As", "Ks", "Qs", "Js", "Ts"],
        note: "Стрит-флеш от десятки до туза — сильнейшая рука в холдеме.",
      },
      {
        type: "callout",
        tone: "gold",
        title: "Практика в PokerStraton",
        text: "Когда загрузите историю раздач, вы будете видеть свои карты и борд в реплее. Уже сейчас полезно вслух называть комбинацию: «у меня топ-пара с кикером», «флеш-дро», «две пары».",
      },
    ],
  },
  {
    id: "m2-positions",
    order: 2,
    title: "Позиции и чарты",
    subtitle: "Почему позиция важнее «красивых» карт",
    durationMin: 4,
    blocks: [
      {
        type: "p",
        text: "Новички смотрят на карты. Профессионалы смотрят на позицию. Кто ходит последним, получает больше информации — и больше прибыли на дистанции.",
      },
      {
        type: "h",
        text: "Карта стола (6-max)",
      },
      {
        type: "grid",
        items: [
          {
            title: "UTG / ранние",
            text: "Ходите первыми. Диапазон открытия узкий: сильные пары и бродвеи.",
          },
          {
            title: "HJ / MP",
            text: "Средние позиции. Чуть шире, чем UTG, но всё ещё дисциплина важнее «красивых» suited-рук.",
          },
          {
            title: "CO / BTN",
            text: "Поздние позиции. Лучшее место за столом: больше стилов, больше прибыльных рук.",
          },
          {
            title: "SB / BB",
            text: "Блайнды. Уже вложили деньги. SB — худшая позиция постфлоп; BB часто защищает, но не любой мусор.",
          },
        ],
      },
      {
        type: "callout",
        tone: "emerald",
        title: "Правило позиции",
        text: "Одну и ту же руку (например, KJo) из UTG чаще фолдят, а с кнопки — открывают. Сила руки зависит от места за столом.",
      },
      {
        type: "h",
        text: "Зачем нужны префлоп-чарты",
      },
      {
        type: "ul",
        items: [
          "Чарт — это ваш стратегия «до флопа»: из какой позиции какую руку играть.",
          "Он убирает хаос: меньше импульсивных коллов «потому что красиво».",
          "В PokerStraton вы рисуете свои чарты и потом сверяете с ними реальные раздачи.",
          "Дисциплина чарта = меньше −EV входов и стабильнее банкролл.",
        ],
      },
      {
        type: "formula",
        title: "Простая модель мышления",
        formula: "Позиция → диапазон → действие (Raise / Call / Fold)",
        note: "Сначала позиция, потом сила руки. Не наоборот.",
      },
      {
        type: "p",
        text: "На следующем модуле перейдём к цифрам: ауты и вероятность улучшить руку.",
      },
    ],
  },
  {
    id: "m3-outs-equity",
    order: 3,
    title: "Ауты и эквити",
    subtitle: "Как оценить шанс собрать руку",
    durationMin: 5,
    blocks: [
      {
        type: "p",
        text: "Аут — это карта, которая улучшает вашу руку до нужной силы. Эквити — доля банков, которую ваша рука выигрывает на дистанции.",
      },
      {
        type: "h",
        text: "Классические примеры аутов",
      },
      {
        type: "ul",
        items: [
          "Флеш-дро: обычно 9 аутов (13 карт масти − 4 уже видимые).",
          "OESD (открытый стрит-дро): обычно 8 аутов.",
          "Гатшот (дырявый стрит): обычно 4 аута.",
          "Оверкарты к борду: часто 3 или 6 аутов до топ-пары (зависит от текстуры).",
        ],
      },
      {
        type: "callout",
        tone: "gold",
        title: "Осторожно с «грязными» аутами",
        text: "Иногда карта, которая «собирает» вам стрит, одновременно делает оппоненту флеш. Такие ауты считают осторожнее.",
      },
      {
        type: "h",
        text: "Правило ×2 и ×4",
      },
      {
        type: "formula",
        title: "На одну улицу",
        formula: "Эквити ≈ ауты × 2%",
        note: "9 аутов флеш-дро ≈ 18% на следующую карту.",
      },
      {
        type: "formula",
        title: "С флопа до ривера",
        formula: "Эквити ≈ ауты × 4%",
        note: "9 аутов ≈ 36% до ривера.",
      },
      {
        type: "grid",
        items: [
          { title: "4 аута", text: "×2 ≈ 8% · ×4 ≈ 16%" },
          { title: "8 аутов", text: "×2 ≈ 16% · ×4 ≈ 32%" },
          { title: "9 аутов", text: "×2 ≈ 18% · ×4 ≈ 36%" },
          { title: "12 аутов", text: "×2 ≈ 24% · ×4 ≈ 48%" },
        ],
      },
    ],
  },
  {
    id: "m4-pot-odds",
    order: 4,
    title: "Шансы банка и pot odds",
    subtitle: "Когда колл — инвестиция, а когда — слив",
    durationMin: 5,
    blocks: [
      {
        type: "p",
        text: "Pot odds отвечают на вопрос: «Достаточно ли часто я буду выигрывать, чтобы колл окупался?»",
      },
      {
        type: "formula",
        title: "Требуемое эквити для колла",
        formula: "Нужно % ≈ Ставка / (Банк + Ставка × 2)",
        note: "Банк — до вашей оплаты. Ставка — сколько нужно доложить.",
      },
      {
        type: "callout",
        tone: "emerald",
        title: "Пример",
        text: "В банке $100, оппонент ставит $50. Требуемое эквити ≈ 25%. Если у дро ≈ 18% — колл минусовый без implied odds.",
      },
      {
        type: "ul",
        items: [
          "Эквити ≥ pot odds — колл оправдан.",
          "Эквити заметно ниже — фолд сохраняет банкролл.",
          "На ривере дро уже нет: решают сила руки и диапазон.",
        ],
      },
      {
        type: "callout",
        tone: "gold",
        title: "Следующий курс",
        text: "Дальше — «Дисциплины и БРМ»: Cash / MTT / Spins, четыре стратегии банкролла и как выбрать путь.",
      },
    ],
  },
];

export const ACADEMY_COURSES: AcademyCourse[] = [
  {
    id: "basics",
    order: 1,
    title: "Базовое понимание покера",
    subtitle: "Комбинации · позиции · ауты · pot odds",
    lead: "Фундамент для новичка: правила холдема, сила рук, позиция и математика колла.",
    modules: BASICS_MODULES,
  },
  {
    id: "disciplines-brm",
    order: 2,
    title: "Дисциплины и банкролл-менеджмент",
    subtitle: "Cash · MTT · Spins · 4 стратегии БРМ",
    lead: "Глубокий разбор трёх форматов, различий в экономике игры и правил управления банкроллом.",
    modules: DISCIPLINE_BRM_MODULES,
  },
];

/** Плоский список всех модулей. */
export const ACADEMY_MODULES: AcademyModule[] = ACADEMY_COURSES.flatMap((c) => c.modules);

export function getCourseById(id: string): AcademyCourse | undefined {
  return ACADEMY_COURSES.find((c) => c.id === id);
}

export function getCourseForModule(moduleId: string): AcademyCourse | undefined {
  return ACADEMY_COURSES.find((c) => c.modules.some((m) => m.id === moduleId));
}

export function getModuleById(id: string): AcademyModule | undefined {
  return ACADEMY_MODULES.find((m) => m.id === id);
}

export function getNextModuleId(id: string): string | null {
  const course = getCourseForModule(id);
  if (!course) return null;
  const idx = course.modules.findIndex((m) => m.id === id);
  if (idx < 0 || idx >= course.modules.length - 1) return null;
  return course.modules[idx + 1].id;
}

export function isCourseCompleted(courseId: string, completed: string[]): boolean {
  const course = getCourseById(courseId);
  if (!course) return false;
  return course.modules.every((m) => completed.includes(m.id));
}

export function courseCompletionPct(courseId: string, completed: string[]): number {
  const course = getCourseById(courseId);
  if (!course || course.modules.length === 0) return 0;
  const done = course.modules.filter((m) => completed.includes(m.id)).length;
  return Math.round((100 * done) / course.modules.length);
}
