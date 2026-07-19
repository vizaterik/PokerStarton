import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PlayingCard from "../components/PlayingCard";
import {
  ACADEMY_COURSES,
  courseCompletionPct,
  getCourseById,
  getCourseForModule,
  getModuleById,
  isCourseCompleted,
  type AcademyCourse,
  type AcademyModule,
  type LessonBlock,
} from "../data/academyLessons";
import {
  academyCompletionPct,
  completeModule,
  isCourseUnlocked,
  isModuleCompleted,
  isModuleUnlocked,
  loadAcademyProgress,
  setActiveCourse,
  setActiveModule,
  type AcademyProgress,
} from "../lib/academyProgress";
import { BRAND } from "../lib/brand";
import { isLoggedIn } from "../api/client";
import "./AcademyPage.css";

function richText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function LessonBlocks({ blocks }: { blocks: LessonBlock[] }) {
  return (
    <div className="acad-blocks">
      {blocks.map((b, i) => {
        if (b.type === "p") {
          return (
            <p key={i} className="acad-p">
              {richText(b.text)}
            </p>
          );
        }
        if (b.type === "h") {
          return (
            <h3 key={i} className="acad-h">
              {b.text}
            </h3>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={i} className="acad-ul">
              {b.items.map((item) => (
                <li key={item}>{richText(item)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={i} className="acad-ol">
              {b.items.map((item) => (
                <li key={item}>{richText(item)}</li>
              ))}
            </ol>
          );
        }
        if (b.type === "callout") {
          return (
            <aside key={i} className={`acad-callout tone-${b.tone ?? "emerald"}`}>
              {b.title ? <em>{b.title}</em> : null}
              <p>{richText(b.text)}</p>
            </aside>
          );
        }
        if (b.type === "combo") {
          return (
            <article key={i} className="acad-combo">
              <header>
                <strong>{b.name}</strong>
                <span>{b.rank}</span>
              </header>
              <div className="acad-combo-cards">
                {b.cards.map((c) => (
                  <PlayingCard key={`${b.name}-${c}`} code={c} size="md" />
                ))}
              </div>
              {b.note ? <p>{b.note}</p> : null}
            </article>
          );
        }
        if (b.type === "formula") {
          return (
            <div key={i} className="acad-formula">
              <em>{b.title}</em>
              <code>{b.formula}</code>
              {b.note ? <p>{b.note}</p> : null}
            </div>
          );
        }
        if (b.type === "grid") {
          return (
            <div key={i} className="acad-grid">
              {b.items.map((item) => (
                <div key={item.title} className="acad-grid-card">
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function LockIcon() {
  return (
    <svg className="acad-ico" viewBox="0 0 24 24" aria-hidden width="16" height="16">
      <path
        fill="currentColor"
        d="M17 9h-1V7a4 4 0 10-8 0v2H7a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2v-8a2 2 0 00-2-2zm-6-2a2 2 0 114 0v2h-4V7zm6 12H7v-8h10v8z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="acad-ico" viewBox="0 0 24 24" aria-hidden width="16" height="16">
      <path
        fill="currentColor"
        d="M9.7 16.3L5.4 12l1.4-1.4 2.9 2.9 7.5-7.5L18.6 7l-8.9 9.3z"
      />
    </svg>
  );
}

type View = "catalog" | "course";

export default function AcademyPage() {
  const [progress, setProgress] = useState<AcademyProgress>(() => loadAcademyProgress());
  const [view, setView] = useState<View>("catalog");
  const [justUnlocked, setJustUnlocked] = useState<string | null>(null);
  const loggedIn = isLoggedIn();

  const activeCourse = useMemo(() => {
    return (
      getCourseById(progress.activeCourseId) ??
      getCourseForModule(progress.activeModuleId) ??
      ACADEMY_COURSES[0]
    );
  }, [progress.activeCourseId, progress.activeModuleId]);

  const active = useMemo(() => {
    const mod = getModuleById(progress.activeModuleId);
    if (mod && activeCourse.modules.some((m) => m.id === mod.id)) return mod;
    return activeCourse.modules[0];
  }, [progress.activeModuleId, activeCourse]);

  const coursePct = courseCompletionPct(activeCourse.id, progress.completed);
  const overallPct = academyCompletionPct(progress.completed);
  const courseDone = isCourseCompleted(activeCourse.id, progress.completed);
  const allDone = ACADEMY_COURSES.every((c) => isCourseCompleted(c.id, progress.completed));
  const activeDone = isModuleCompleted(active.id, progress.completed);
  const isLastInCourse = active.order === activeCourse.modules.length;
  const doneCourses = ACADEMY_COURSES.filter((c) =>
    isCourseCompleted(c.id, progress.completed),
  ).length;

  const openCourse = (course: AcademyCourse) => {
    if (!isCourseUnlocked(course.id, progress.completed)) return;
    setJustUnlocked(null);
    setProgress(setActiveCourse(course.id, progress));
    setView("course");
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const backToCatalog = () => {
    setJustUnlocked(null);
    setView("catalog");
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const selectModule = (mod: AcademyModule) => {
    if (!isModuleUnlocked(mod.id, progress.completed)) return;
    setJustUnlocked(null);
    setProgress(setActiveModule(mod.id, progress));
  };

  const finishLesson = () => {
    const next = completeModule(active.id, progress);
    setProgress(next);
    if (next.activeModuleId !== active.id) {
      setJustUnlocked(next.activeModuleId);
      requestAnimationFrame(() => {
        document.querySelector(".acad-lesson")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else {
      requestAnimationFrame(() => {
        document.querySelector(".acad-finale")?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  };

  return (
    <div className="acad-page">
      {view === "catalog" ? (
        <>
          <header className="acad-hero acad-hero-catalog">
            <div className="acad-hero-copy">
              <p className="acad-kicker">Академия {BRAND}</p>
              <h1>Курсы обучения</h1>
              <p className="acad-hero-lead">
                Выберите курс. Подробная программа и уроки откроются после входа в курс.
              </p>
            </div>
            <div className="acad-progress-card" aria-label="Общий прогресс">
              <span className="acad-progress-label">Общий прогресс</span>
              <strong>{overallPct}%</strong>
              <div className="acad-progress-track">
                <i style={{ width: `${overallPct}%` }} />
              </div>
              <em>
                Пройдено курсов: {doneCourses} из {ACADEMY_COURSES.length}
              </em>
            </div>
          </header>

          <div className="acad-course-grid acad-course-grid-catalog" aria-label="Список курсов">
            {ACADEMY_COURSES.map((course) => {
              const unlocked = isCourseUnlocked(course.id, progress.completed);
              const done = isCourseCompleted(course.id, progress.completed);
              const pct = courseCompletionPct(course.id, progress.completed);
              const mins = course.modules.reduce((s, m) => s + m.durationMin, 0);
              return (
                <button
                  key={course.id}
                  type="button"
                  disabled={!unlocked}
                  className={[
                    "acad-course-card",
                    done ? "is-done" : "",
                    !unlocked ? "is-locked" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => openCourse(course)}
                >
                  <div className="acad-course-card-top">
                    <span className="acad-course-order">Курс {course.order}</span>
                    {!unlocked ? (
                      <span className="acad-status acad-status-locked">
                        <LockIcon /> Закрыт
                      </span>
                    ) : done ? (
                      <span className="acad-status acad-status-done">
                        <CheckIcon /> Пройден
                      </span>
                    ) : pct > 0 ? (
                      <span className="acad-status acad-status-progress">В процессе · {pct}%</span>
                    ) : (
                      <span className="acad-status">Доступен</span>
                    )}
                  </div>
                  <strong>{course.title}</strong>
                  <em>{course.subtitle}</em>
                  <p>{course.lead}</p>
                  <div className="acad-course-foot">
                    <span>{course.modules.length} модулей</span>
                    <span>~{mins} мин</span>
                  </div>
                  {unlocked ? (
                    <span className="acad-course-cta">
                      {done ? "Открыть снова" : "Открыть курс"}
                    </span>
                  ) : (
                    <span className="acad-course-cta is-muted">
                      Сначала завершите предыдущий курс
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {allDone ? (
            <div className="acad-finale acad-finale-catalog">
              <p className="acad-finale-kicker">Академия</p>
              <h3>Все курсы пройдены</h3>
              <p>Дальше — стратегии, Карьера и разбор своих сессий.</p>
              <Link className="acad-finale-cta" to={loggedIn ? "/strategies" : "/login"}>
                {loggedIn ? "К стратегиям" : "Войти"}
              </Link>
            </div>
          ) : null}
        </>
      ) : null}

      {view === "course" ? (
        <>
      <header className="acad-hero">
        <div className="acad-hero-copy">
          <button type="button" className="acad-back" onClick={backToCatalog}>
            ← Все курсы
          </button>
          <p className="acad-kicker">
            Курс {activeCourse.order} · Академия {BRAND}
          </p>
          <h1>{activeCourse.title}</h1>
          <p className="acad-hero-lead">{activeCourse.lead}</p>
        </div>
        <div className="acad-progress-card" aria-label="Прогресс курса">
          <span className="acad-progress-label">Прогресс курса</span>
          <strong>{coursePct}%</strong>
          <div className="acad-progress-track">
            <i style={{ width: `${coursePct}%` }} />
          </div>
          <em>
            {activeCourse.modules.filter((m) => progress.completed.includes(m.id)).length} из{" "}
            {activeCourse.modules.length} модулей
            {courseDone ? " · Пройден" : ""}
          </em>
        </div>
      </header>

      <div className="acad-layout">
        <aside className="acad-roadmap" aria-label="Модули курса">
          <h2>Программа</h2>
          <p className="acad-roadmap-lead muted">{activeCourse.subtitle}</p>
          <ol className="acad-modules">
            {activeCourse.modules.map((mod, idx) => {
              const unlocked = isModuleUnlocked(mod.id, progress.completed);
              const done = isModuleCompleted(mod.id, progress.completed);
              const current = mod.id === active.id;
              return (
                <li key={mod.id}>
                  <button
                    type="button"
                    className={[
                      "acad-mod-btn",
                      current ? "is-current" : "",
                      done ? "is-done" : "",
                      !unlocked ? "is-locked" : "",
                      justUnlocked === mod.id ? "is-unlocking" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={!unlocked}
                    onClick={() => selectModule(mod)}
                  >
                    <span className="acad-mod-idx" aria-hidden>
                      {done ? <CheckIcon /> : !unlocked ? <LockIcon /> : idx + 1}
                    </span>
                    <span className="acad-mod-text">
                      <strong>
                        Модуль {mod.order}. {mod.title}
                      </strong>
                      <em>{mod.subtitle}</em>
                    </span>
                    <span className="acad-mod-meta">{mod.durationMin} мин</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <section className="acad-lesson" key={active.id}>
          <div className="acad-lesson-head">
            <span className="acad-lesson-tag">Модуль {active.order}</span>
            <h2>{active.title}</h2>
            <p>{active.subtitle}</p>
          </div>

          <LessonBlocks blocks={active.blocks} />

          <footer className="acad-lesson-footer">
            {activeDone ? (
              <div className="acad-done-note">
                <CheckIcon />
                <span>
                  Урок завершён
                  {isLastInCourse
                    ? courseDone
                      ? ". Курс пройден."
                      : "."
                    : ". Следующий модуль открыт."}
                </span>
              </div>
            ) : (
              <button type="button" className="acad-complete-btn" onClick={finishLesson}>
                Материал изучен. Перейти к следующему шагу
              </button>
            )}

            {activeDone && !isLastInCourse ? (
              <button
                type="button"
                className="acad-next-link"
                onClick={() => {
                  const next = activeCourse.modules[active.order];
                  if (next) selectModule(next);
                }}
              >
                Открыть модуль {active.order + 1} →
              </button>
            ) : null}
          </footer>

          {courseDone && isLastInCourse && activeDone ? (
            <div className="acad-finale">
              <p className="acad-finale-kicker">Финал курса</p>
              <h3>
                {activeCourse.id === "basics" ? "База освоена" : "Дисциплины и БРМ пройдены"}
              </h3>
              <p>
                {activeCourse.id === "basics"
                  ? "Вернитесь к списку курсов и откройте «Дисциплины и банкролл-менеджмент»."
                  : "Соберите стратегию под выбранную дисциплину и задайте БРМ в Карьере."}
              </p>
              {activeCourse.id === "basics" ? (
                <button type="button" className="acad-finale-cta" onClick={backToCatalog}>
                  К списку курсов →
                </button>
              ) : (
                <Link className="acad-finale-cta" to={loggedIn ? "/strategies" : "/login"}>
                  {loggedIn ? "Собрать стратегию" : "Войти и собрать стратегию"}
                </Link>
              )}
            </div>
          ) : null}
        </section>
      </div>
        </>
      ) : null}
    </div>
  );
}
