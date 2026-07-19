import { useId, useState } from "react";
import { BRAND } from "../lib/brand";
import { LegalDoc } from "../lib/termsOfService";
import TermsModal from "./TermsModal";

export default function SiteFooter() {
  const [doc, setDoc] = useState<LegalDoc | null>(null);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <p className="site-footer-line">
            <span>© 2026 PokerStraton.ru. Все права защищены.</span>{" "}
            <span className="site-footer-label">Подробнее о платформе</span>{" "}
            <button
              type="button"
              className="site-footer-toggle"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((v) => !v)}
            >
              [{open ? "Свернуть" : "Показать полностью"}]
            </button>
          </p>

          <div
            id={panelId}
            className={`site-footer-spoiler${open ? " is-open" : ""}`}
            aria-hidden={!open}
          >
            <div className="site-footer-spoiler-inner">
              <p>
                {BRAND} является независимым аналитическим веб-приложением, предоставляющим
                инструменты для пост-анализа сыгранных сессий и ведения личной спортивной статистики.
                Платформа не является организатором азартных игр, не принимает ставки, не выплачивает
                выигрыши и не предоставляет подсказок в реальном времени (RTA).
              </p>
              <p>
                Все расчёты, графики, отчёты об ошибках и показатели банкролла (включая символы валют
                $) отображаются исключительно в информационно-аналитических целях как условные
                единицы измерения математической эффективности и игровой дисциплины Пользователя.
                Сервис не оперирует реальными денежными средствами Пользователей. Использование
                сервиса осуществляется на условиях «как есть» (As Is). Администрация платформы не
                несёт ответственности за игровые результаты Пользователя в сторонних покер-румах.
              </p>
            </div>
          </div>

          <nav className="site-footer-links" aria-label="Правовая информация">
            <button type="button" onClick={() => setDoc("terms")}>
              Пользовательское соглашение
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={() => setDoc("privacy")}>
              Политика конфиденциальности
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={() => setDoc("support")}>
              Контакты службы поддержки
            </button>
          </nav>
        </div>
      </footer>

      <TermsModal open={doc !== null} doc={doc ?? "terms"} onClose={() => setDoc(null)} />
    </>
  );
}
