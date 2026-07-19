import {
  ACADEMY_COURSES,
  ACADEMY_MODULES,
  getCourseById,
  getCourseForModule,
  isCourseCompleted,
} from "../data/academyLessons";

const STORAGE_KEY = "pokerstraton.academy.progress.v2";

export type AcademyProgress = {
  /** Завершённые модули (id). */
  completed: string[];
  /** Активный модуль. */
  activeModuleId: string;
  /** Активный курс. */
  activeCourseId: string;
  updatedAt: string;
};

function defaultProgress(): AcademyProgress {
  const firstCourse = ACADEMY_COURSES[0];
  const firstModule = firstCourse?.modules[0];
  return {
    completed: [],
    activeModuleId: firstModule?.id ?? "m1-basics",
    activeCourseId: firstCourse?.id ?? "basics",
    updatedAt: new Date().toISOString(),
  };
}

export function loadAcademyProgress(): AcademyProgress {
  try {
    // Миграция со старого ключа v1
    const rawV2 = localStorage.getItem(STORAGE_KEY);
    const rawV1 = localStorage.getItem("pokerstraton.academy.progress.v1");
    const raw = rawV2 ?? rawV1;
    if (!raw) return defaultProgress();
    const parsed = JSON.parse(raw) as Partial<AcademyProgress> & { activeModuleId?: string };
    const completed = Array.isArray(parsed.completed)
      ? parsed.completed.filter((id): id is string => typeof id === "string")
      : [];
    let activeModuleId =
      typeof parsed.activeModuleId === "string" &&
      ACADEMY_MODULES.some((m) => m.id === parsed.activeModuleId)
        ? parsed.activeModuleId
        : defaultProgress().activeModuleId;
    const course = getCourseForModule(activeModuleId) ?? ACADEMY_COURSES[0];
    let activeCourseId =
      typeof parsed.activeCourseId === "string" && getCourseById(parsed.activeCourseId)
        ? parsed.activeCourseId
        : course?.id ?? "basics";
    // Если курс в прогрессе не совпадает с модулем — выровнять
    const courseOfModule = getCourseForModule(activeModuleId);
    if (courseOfModule) activeCourseId = courseOfModule.id;
    const progress: AcademyProgress = {
      completed,
      activeModuleId,
      activeCourseId,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
    if (!rawV2) saveAcademyProgress(progress);
    return progress;
  } catch {
    return defaultProgress();
  }
}

export function saveAcademyProgress(progress: AcademyProgress): void {
  const next = { ...progress, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/** Курс открыт, если предыдущий полностью пройден (первый — всегда). */
export function isCourseUnlocked(courseId: string, completed: string[]): boolean {
  const idx = ACADEMY_COURSES.findIndex((c) => c.id === courseId);
  if (idx <= 0) return true;
  const prev = ACADEMY_COURSES[idx - 1];
  return isCourseCompleted(prev.id, completed);
}

export function isModuleUnlocked(moduleId: string, completed: string[]): boolean {
  const course = getCourseForModule(moduleId);
  if (!course) return false;
  if (!isCourseUnlocked(course.id, completed)) return false;
  const idx = course.modules.findIndex((m) => m.id === moduleId);
  if (idx <= 0) return true;
  return completed.includes(course.modules[idx - 1].id);
}

export function isModuleCompleted(moduleId: string, completed: string[]): boolean {
  return completed.includes(moduleId);
}

export function completeModule(moduleId: string, current: AcademyProgress): AcademyProgress {
  const completed = current.completed.includes(moduleId)
    ? current.completed
    : [...current.completed, moduleId];
  const course = getCourseForModule(moduleId);
  const idx = course?.modules.findIndex((m) => m.id === moduleId) ?? -1;
  let nextModuleId = moduleId;
  let nextCourseId = course?.id ?? current.activeCourseId;
  if (course && idx >= 0 && idx < course.modules.length - 1) {
    nextModuleId = course.modules[idx + 1].id;
  } else if (course) {
    // Конец курса — если есть следующий курс и он открыт, перейти к его первому модулю
    const cIdx = ACADEMY_COURSES.findIndex((c) => c.id === course.id);
    const nextCourse = ACADEMY_COURSES[cIdx + 1];
    if (nextCourse && isCourseUnlocked(nextCourse.id, completed)) {
      nextCourseId = nextCourse.id;
      nextModuleId = nextCourse.modules[0]?.id ?? moduleId;
    }
  }
  const next: AcademyProgress = {
    completed,
    activeModuleId: nextModuleId,
    activeCourseId: nextCourseId,
    updatedAt: new Date().toISOString(),
  };
  saveAcademyProgress(next);
  return next;
}

export function setActiveModule(moduleId: string, current: AcademyProgress): AcademyProgress {
  if (!isModuleUnlocked(moduleId, current.completed)) return current;
  const course = getCourseForModule(moduleId);
  const next = {
    ...current,
    activeModuleId: moduleId,
    activeCourseId: course?.id ?? current.activeCourseId,
    updatedAt: new Date().toISOString(),
  };
  saveAcademyProgress(next);
  return next;
}

export function setActiveCourse(courseId: string, current: AcademyProgress): AcademyProgress {
  if (!isCourseUnlocked(courseId, current.completed)) return current;
  const course = getCourseById(courseId);
  if (!course) return current;
  // Открыть первый незавершённый модуль или первый
  const firstOpen =
    course.modules.find((m) => !current.completed.includes(m.id)) ?? course.modules[0];
  if (!firstOpen || !isModuleUnlocked(firstOpen.id, current.completed)) {
    const first = course.modules[0];
    if (!first) return current;
    return setActiveModule(first.id, { ...current, activeCourseId: courseId });
  }
  return setActiveModule(firstOpen.id, { ...current, activeCourseId: courseId });
}

export function academyCompletionPct(completed: string[]): number {
  if (!ACADEMY_MODULES.length) return 0;
  return Math.round((100 * completed.length) / ACADEMY_MODULES.length);
}
