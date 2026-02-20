"""Google OAuth 2.0 authentication routes.

Provides /login (redirect to Google) and /oauth/callback (exchange code for tokens).
Also provides a dev login bypass for local development.
"""

from __future__ import annotations

import hashlib

import httpx
import structlog
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

from app.auth.sessions import create_session
from app.auth.tokens import create_access_token, verify_access_token
from app.config import settings

logger = structlog.get_logger()

router = APIRouter(tags=["auth"])

# ─── Google OAuth URLs ────────────────────────────────────────

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


# ─── Login Route ──────────────────────────────────────────────


@router.get("/login")
async def login(request: Request) -> RedirectResponse:
    """Redirect user to Google OAuth consent page."""
    if settings.dev_mode and settings.dev_login_enabled:
        # In dev mode, redirect to the dev login form
        return RedirectResponse(url="/auth/dev-login")

    if not settings.google_client_id or not settings.google_client_secret:
        return RedirectResponse(url="/auth/dev-login")

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "email profile",
        "access_type": "offline",
        "prompt": "consent",
    }

    query = "&".join(f"{k}={v}" for k, v in params.items())
    auth_url = f"{GOOGLE_AUTH_URL}?{query}"

    logger.info("auth.login.redirect", url=auth_url)
    return RedirectResponse(url=auth_url)


# ─── OAuth Callback ───────────────────────────────────────────


@router.get("/oauth/callback")
async def oauth_callback(request: Request, code: str) -> Response:
    """Exchange Google OAuth authorization code for tokens.

    1. Exchange code for Google access token
    2. Fetch user info from Google
    3. Issue our own JWT
    4. Set as HttpOnly cookie
    """
    log = logger.bind(correlation_id=getattr(request.state, "correlation_id", "unknown"))

    try:
        # Exchange code for tokens
        async with httpx.AsyncClient() as client:
            token_response = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": settings.google_redirect_uri,
                    "grant_type": "authorization_code",
                },
            )

            if token_response.status_code != 200:
                log.error(
                    "auth.oauth.token_exchange_failed",
                    status=token_response.status_code,
                    body=token_response.text,
                )
                return JSONResponse(
                    status_code=401,
                    content={"error": "Failed to exchange authorization code"},
                )

            token_data = token_response.json()
            google_access_token = token_data["access_token"]

            # Fetch user info
            userinfo_response = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {google_access_token}"},
            )

            if userinfo_response.status_code != 200:
                log.error("auth.oauth.userinfo_failed", status=userinfo_response.status_code)
                return JSONResponse(
                    status_code=401,
                    content={"error": "Failed to fetch user info from Google"},
                )

            userinfo = userinfo_response.json()

        # Extract user data
        google_id = userinfo.get("id", "")
        email = userinfo.get("email", "")
        name = userinfo.get("name", "")

        log.info("auth.oauth.success", email=email, google_id=google_id, name=name)

        # Issue our JWT
        access_token = create_access_token(
            user_id=google_id,
            email=email,
            roles=["user"],  # Default role; will be enriched from DB later
        )

        # Create Redis session for revocation support
        try:
            claims = verify_access_token(access_token)
            await create_session(
                jti=claims.jti,
                user_id=google_id,
                email=email,
                roles=["user"],
                ttl_seconds=settings.jwt_expiry_minutes * 60,
            )
        except Exception as session_exc:
            log.warning("auth.session_create_failed", error=str(session_exc))

        # Set cookie and redirect to dashboard
        response = RedirectResponse(url="/", status_code=302)
        response.set_cookie(
            key="gatekeeper_token",
            value=access_token,
            httponly=True,
            secure=not settings.dev_mode,
            samesite="lax",
            max_age=settings.jwt_expiry_minutes * 60,
            path="/",
        )

        return response

    except Exception as exc:
        log.error("auth.oauth.error", error=str(exc))
        return JSONResponse(
            status_code=500,
            content={"error": "Authentication failed", "detail": str(exc)},
        )


# ─── Dev Login (local development only) ──────────────────────


@router.get("/auth/dev-login")
async def dev_login_page() -> Response:
    """Serve a simple dev login form (dev mode only)."""
    if not settings.dev_mode:
        return JSONResponse(
            status_code=404,
            content={"error": "Dev login is not available in production"},
        )

    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Gatekeeper — Dev Login</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                background: #0f172a;
                color: #e2e8f0;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
            }
            .card {
                background: #1e293b;
                border: 1px solid #334155;
                border-radius: 12px;
                padding: 2rem;
                width: 400px;
                box-shadow: 0 4px 24px rgba(0,0,0,0.3);
            }
            .card h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
            .card p { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }
            .badge {
                display: inline-block;
                background: #f59e0b;
                color: #000;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 0.75rem;
                font-weight: 600;
                margin-bottom: 1rem;
            }
            label { font-size: 0.875rem; color: #94a3b8; display: block; margin-bottom: 0.25rem; }
            input {
                width: 100%;
                padding: 0.5rem 0.75rem;
                border: 1px solid #475569;
                border-radius: 6px;
                background: #0f172a;
                color: #e2e8f0;
                font-size: 0.875rem;
                margin-bottom: 1rem;
            }
            input:focus { outline: none; border-color: #3b82f6; }
            button {
                width: 100%;
                padding: 0.625rem;
                background: #3b82f6;
                color: white;
                border: none;
                border-radius: 6px;
                font-size: 0.875rem;
                font-weight: 500;
                cursor: pointer;
            }
            button:hover { background: #2563eb; }
            select {
                width: 100%;
                padding: 0.5rem 0.75rem;
                border: 1px solid #475569;
                border-radius: 6px;
                background: #0f172a;
                color: #e2e8f0;
                font-size: 0.875rem;
                margin-bottom: 1rem;
            }
        </style>
    </head>
    <body>
        <div class="card">
            <span class="badge">⚠ DEV MODE</span>
            <h1>🔐 Gatekeeper Dev Login</h1>
            <p>This login bypasses Google OAuth for local development.</p>
            <form method="POST" action="/auth/dev-login">
                <label for="email">Email</label>
                <input type="email" id="email" name="email"
                       value="dev@gatekeeper.local" required>

                <label for="role">Role</label>
                <select id="role" name="role">
                    <option value="user">user</option>
                    <option value="hr">hr</option>
                    <option value="admin" selected>admin</option>
                </select>

                <button type="submit">Sign In (Dev)</button>
            </form>
        </div>
    </body>
    </html>
    """
    return Response(content=html, media_type="text/html")


@router.post("/auth/dev-login")
async def dev_login_submit(request: Request) -> Response:
    """Process dev login form submission."""
    if not settings.dev_mode:
        return JSONResponse(
            status_code=404,
            content={"error": "Dev login is not available in production"},
        )

    form = await request.form()
    email = str(form.get("email", "dev@gatekeeper.local"))
    role = str(form.get("role", "user"))

    # Generate a dev user ID from email
    user_id = hashlib.sha256(email.encode()).hexdigest()[:16]

    logger.info("auth.dev_login", email=email, role=role, user_id=user_id)

    # Issue JWT
    access_token = create_access_token(
        user_id=user_id,
        email=email,
        roles=[role],
    )

    # Create Redis session
    try:
        claims = verify_access_token(access_token)
        await create_session(
            jti=claims.jti,
            user_id=user_id,
            email=email,
            roles=[role],
            ttl_seconds=settings.jwt_expiry_minutes * 60,
        )
    except Exception as session_exc:
        logger.warning("auth.session_create_failed", error=str(session_exc))

    # Set cookie and redirect
    response = RedirectResponse(url="/", status_code=302)
    response.set_cookie(
        key="gatekeeper_token",
        value=access_token,
        httponly=True,
        secure=False,  # Dev mode
        samesite="lax",
        max_age=settings.jwt_expiry_minutes * 60,
        path="/",
    )

    return response


# ─── Logout ───────────────────────────────────────────────────


@router.post("/auth/logout")
@router.get("/auth/logout")
async def logout() -> Response:
    """Clear the authentication cookie."""
    response = RedirectResponse(url="/login", status_code=302)
    response.delete_cookie("gatekeeper_token", path="/")
    logger.info("auth.logout")
    return response


# ─── Token Info (for debugging/API clients) ──────────────────


@router.get("/auth/me")
async def auth_me(request: Request) -> JSONResponse:
    """Return the current user's token claims."""
    user = getattr(request.state, "current_user", None)
    if not user:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    return JSONResponse(content=user.to_dict())
