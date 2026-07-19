import logging
import smtplib
import ssl
from email.message import EmailMessage
from html import escape

from app.core.config import settings

logger = logging.getLogger(__name__)

BRAND = "PokerStraton"
CODE_TTL_MINUTES = 15


def smtp_configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_from)


def _plain_body(code: str) -> str:
    return (
        f"{BRAND} — код подтверждения\n\n"
        f"Ваш код: {code}\n\n"
        f"Код действует {CODE_TTL_MINUTES} минут.\n"
        f"Если вы не регистрировались в {BRAND}, просто игнорируйте это письмо.\n"
    )


def _html_body(code: str) -> str:
    safe_code = escape(code)
    return f"""\
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{BRAND} — код подтверждения</title>
</head>
<body style="margin:0;padding:0;background:#0a0c0e;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0a0c0e" style="background-color:#0a0c0e;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#14181c;border:1px solid #2a3036;border-radius:18px;">
          <tr>
            <td bgcolor="#3ecf8e" style="height:4px;background-color:#3ecf8e;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:32px 28px 12px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
              <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#3ecf8e;">
                {BRAND}
              </p>
              <h1 style="margin:0 0 10px;font-size:26px;line-height:1.2;font-weight:700;color:#f4f7f5;">
                Подтвердите email
              </h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#9aa3a0;">
                Введите код ниже на экране подтверждения, чтобы завершить регистрацию.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 28px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;background-color:#0f1316;border:1px solid #2a3036;border-radius:14px;">
                <tr>
                  <td style="padding:22px 36px;font-family:Consolas,Menlo,Monaco,monospace;font-size:36px;font-weight:700;letter-spacing:0.35em;color:#3ecf8e;text-align:center;">
                    {safe_code}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 32px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
              <p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:#9aa3a0;">
                Код действует <strong style="color:#e8ece9;">{CODE_TTL_MINUTES} минут</strong>.
                Никому его не сообщайте.
              </p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#6b7370;">
                Если вы не регистрировались в {BRAND}, просто проигнорируйте это письмо.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:11px;color:#4a5250;">
          © {BRAND} · Стратегия на краю стола
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
"""


def _send_via_smtp(message: EmailMessage) -> None:
    host = settings.smtp_host
    port = settings.smtp_port
    user = settings.smtp_user
    password = settings.smtp_password
    use_ssl = port == 465 or not settings.smtp_tls
    context = ssl.create_default_context()

    if use_ssl and port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=25, context=context) as smtp:
            if user:
                smtp.login(user, password)
            smtp.send_message(message)
        return

    with smtplib.SMTP(host, port, timeout=25) as smtp:
        if settings.smtp_tls:
            smtp.starttls(context=context)
        if user:
            smtp.login(user, password)
        smtp.send_message(message)


def send_verification_email(to_email: str, code: str) -> None:
    subject = f"{BRAND}: код подтверждения {code}"
    plain = _plain_body(code)
    html = _html_body(code)

    if not smtp_configured():
        logger.warning("SMTP не настроен — код для %s: %s", to_email, code)
        print(f"[{BRAND}] Код подтверждения для {to_email}: {code}", flush=True)
        return

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from
    message["To"] = to_email
    message.set_content(plain)
    message.add_alternative(html, subtype="html")

    try:
        _send_via_smtp(message)
        logger.info("Verification email sent to %s", to_email)
    except Exception:
        logger.exception("Failed to send verification email to %s", to_email)
        raise
