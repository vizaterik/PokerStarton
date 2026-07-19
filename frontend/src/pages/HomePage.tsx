import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { isLoggedIn } from "../api/client";
import { BRAND, BRAND_TAGLINE } from "../lib/brand";

const PATTERN = [
  "raise", "raise", "raise", "call", "call", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold",
  "raise", "raise", "raise", "call", "call", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold",
  "raise", "raise", "call", "call", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold",
  "raise", "call", "call", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold",
  "call", "call", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold",
  "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold",
  "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold",
  "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold",
  "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold",
  "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold",
  "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold",
  "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold",
  "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold", "fold",
] as const;

type Slide = {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
  body?: string;
  points?: string[];
  visual: "hero" | "matrix" | "errors" | "trainer" | "close";
};

const SLIDES: Slide[] = [
  {
    id: "hero",
    eyebrow: "01",
    title: BRAND,
    lead: BRAND_TAGLINE,
    body: "Стратегия → анализ сессии → тренажёр. Эталон — твои чарты.",
    visual: "hero",
  },
  {
    id: "strategy",
    eyebrow: "02 · Стратегия",
    title: "Собери префлоп-дерево и задай диапазоны",
    lead: "Ветки по позициям и линиям. Матрица 13×13 с raise / call / fold.",
    points: [
      "RFI, vs open, 3-bet, squeeze — дерево как за столом",
      "Редактор чарта: миксы и частоты по каждой руке",
      "Сохранил — анализ и тренажёр уже смотрят на эти чарты",
    ],
    visual: "matrix",
  },
  {
    id: "analysis",
    eyebrow: "03 · Анализ",
    title: "Сессия против твоей стратегии",
    lead: "Загрузи HH — каждое решение героя сверяется с чартом.",
    points: [
      "Точность по позициям и веткам",
      "Список ошибок + реплей",
      "Матрица: стратегия слева, ошибки справа",
      "VPIP / PFR / профит по сессии",
    ],
    visual: "errors",
  },
  {
    id: "trainer",
    eyebrow: "04 · Тренажёр",
    title: "Тренируй споты из своих раздач",
    lead: "Raise / call / fold — ответ сразу против твоего чарта.",
    points: [
      "Пул из загруженной истории",
      "Фильтр по позициям",
      "Та же стратегия, что в анализе",
    ],
    visual: "trainer",
  },
  {
    id: "close",
    eyebrow: "05",
    title: "Стратегия. Анализ. Тренажёр.",
    lead: "Задай стратегию, загрузи сессию, прокачай слабые споты.",
    visual: "close",
  },
];

export default function HomePage() {
  const loggedIn = isLoggedIn();
  const deckRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const goTo = useCallback((index: number) => {
    const deck = deckRef.current;
    if (!deck) return;
    const slide = deck.querySelectorAll<HTMLElement>(".deck-slide")[index];
    slide?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const slides = [...deck.querySelectorAll<HTMLElement>(".deck-slide")];
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const idx = slides.indexOf(visible.target as HTMLElement);
        if (idx >= 0) setActive(idx);
      },
      { root: deck, threshold: [0.45, 0.6, 0.75] },
    );
    slides.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        goTo(Math.min(active + 1, SLIDES.length - 1));
      }
      if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        goTo(Math.max(active - 1, 0));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, goTo]);

  return (
    <div className="deck-page">
      <div className="deck" ref={deckRef}>
        {SLIDES.map((slide, index) => (
          <section
            key={slide.id}
            className={`deck-slide${index === active ? " is-active" : ""}`}
            data-visual={slide.visual}
            aria-label={`${slide.eyebrow}. ${slide.title}`}
          >
            <div className="deck-slide-inner">
              <div className="deck-copy">
                <p className="deck-eyebrow">
                  <span>{slide.eyebrow}</span>
                  <em>
                    {index + 1} / {SLIDES.length}
                  </em>
                </p>
                <h2 className={slide.visual === "hero" ? "deck-brand" : undefined}>
                  {slide.title}
                </h2>
                <p className="deck-lead">{slide.lead}</p>
                {slide.body ? <p className="deck-body">{slide.body}</p> : null}
                {slide.points && slide.points.length > 0 ? (
                  <ul className="deck-points">
                    {slide.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : null}

                {(slide.visual === "hero" || slide.visual === "close") && (
                  <div className="hero-actions deck-cta">
                    {loggedIn ? (
                      <>
                        <Link className="cta" to="/analysis">
                          Анализ
                        </Link>
                        <Link className="cta-secondary" to="/strategies">
                          Конструктор
                        </Link>
                      </>
                    ) : (
                      <>
                        <Link
                          className="cta"
                          to="/login"
                          state={{ mode: "register" }}
                        >
                          Создать аккаунт
                        </Link>
                        <Link
                          className="cta-secondary"
                          to="/login"
                          state={{ mode: "login" }}
                        >
                          Вход
                        </Link>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="deck-visual" aria-hidden>
                {slide.visual === "hero" || slide.visual === "matrix" ? (
                  <div className="deck-matrix">
                    {PATTERN.map((kind, i) => (
                      <i key={i} className={kind} />
                    ))}
                  </div>
                ) : null}
                {slide.visual === "errors" ? (
                  <div className="deck-errors">
                    <div>
                      <span>Стратегия</span>
                      <div className="deck-mini-grid">
                        {PATTERN.slice(0, 36).map((k, i) => (
                          <i key={i} className={k} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <span>Ошибки</span>
                      <div className="deck-mini-grid is-errors">
                        {Array.from({ length: 36 }, (_, i) => (
                          <i
                            key={i}
                            className={i % 7 === 0 ? "raise" : i % 5 === 0 ? "call" : "fold"}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                {slide.visual === "trainer" ? (
                  <div className="deck-trainer">
                    <div className="deck-trainer-head">
                      <span>BTN · RFI</span>
                      <em>100bb</em>
                    </div>
                    <div className="deck-trainer-table">
                      <div className="deck-trainer-rail" />
                      <div className="deck-trainer-felt">
                        <div className="deck-trainer-pot">Pot 1.5bb</div>
                        <div className="deck-trainer-cards">
                          <span className="deck-card is-red">
                            A<span>♥</span>
                          </span>
                          <span className="deck-card is-red">
                            K<span>♥</span>
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="deck-trainer-prompt">Твой ход</div>
                    <div className="deck-trainer-actions">
                      <span className="is-fold">Fold</span>
                      <span className="is-call">Call</span>
                      <span className="is-raise is-pick">Raise</span>
                    </div>
                    <div className="deck-trainer-ok">По чарту · Raise 2.5x</div>
                  </div>
                ) : null}
                {slide.visual === "close" ? (
                  <div className="deck-close-mark">
                    <span>{BRAND}</span>
                    <em>{BRAND_TAGLINE}</em>
                  </div>
                ) : null}
              </div>
            </div>

            {index < SLIDES.length - 1 ? (
              <button
                type="button"
                className="deck-next"
                onClick={() => goTo(index + 1)}
              >
                Далее
                <span aria-hidden>↓</span>
              </button>
            ) : null}
          </section>
        ))}
      </div>

      <nav className="deck-dots" aria-label="Слайды презентации">
        {SLIDES.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            className={index === active ? "is-active" : ""}
            aria-label={slide.title}
            aria-current={index === active ? "true" : undefined}
            onClick={() => goTo(index)}
          />
        ))}
      </nav>
    </div>
  );
}
