import { useEffect } from "react";
import { BRAND } from "../lib/brand";
import { LegalDoc, legalDocMeta } from "../lib/termsOfService";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Default: terms (same modal as registration). */
  doc?: LegalDoc;
};

export default function TermsModal({ open, onClose, doc = "terms" }: Props) {
  const meta = legalDocMeta(doc);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="terms-overlay" role="presentation" onClick={onClose}>
      <div
        className="terms-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="terms-modal-head">
          <div>
            <p className="terms-kicker">{BRAND}</p>
            <h2 id="terms-title">{meta.title}</h2>
            {meta.versionLabel ? <p className="muted">{meta.versionLabel}</p> : null}
          </div>
          <button type="button" className="cta-secondary terms-close-x" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>

        <div className="terms-modal-body">
          {meta.sections.map((section) => (
            <section key={section.title} className="terms-section">
              <h3>{section.title}</h3>
              {section.paragraphs.map((p) => (
                <p key={p.slice(0, 64)}>{p}</p>
              ))}
            </section>
          ))}
        </div>

        <footer className="terms-modal-foot">
          <button type="button" className="cta" onClick={onClose}>
            Закрыть
          </button>
        </footer>
      </div>
    </div>
  );
}
