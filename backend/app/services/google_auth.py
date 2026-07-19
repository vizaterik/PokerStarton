from google.auth.transport import requests
from google.oauth2 import id_token

from app.core.config import settings


class GoogleTokenError(Exception):
    pass


def verify_google_id_token(token: str) -> dict[str, str]:
    if not settings.google_client_id:
        raise GoogleTokenError("Google sign-in is not configured")
    try:
        payload = id_token.verify_oauth2_token(
            token,
            requests.Request(),
            settings.google_client_id,
        )
    except ValueError as exc:
        raise GoogleTokenError("Invalid Google token") from exc

    if payload.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
        raise GoogleTokenError("Invalid Google token issuer")

    sub = payload.get("sub")
    email = payload.get("email")
    if not sub or not email:
        raise GoogleTokenError("Google token is missing email")
    if not payload.get("email_verified", False):
        raise GoogleTokenError("Google email is not verified")

    return {
        "sub": str(sub),
        "email": str(email).lower(),
        "name": str(payload.get("name") or ""),
        "picture": str(payload.get("picture") or ""),
    }
