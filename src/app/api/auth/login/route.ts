import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  createAuthToken,
  isAuthEnabled,
  isRequestAuthenticated,
  verifyPassword,
} from "@/lib/auth";

export async function GET() {
  const authEnabled = isAuthEnabled();
  const authenticated = await isRequestAuthenticated();
  return NextResponse.json({ authEnabled, authenticated });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { password?: string };
    if (!isAuthEnabled()) {
      return NextResponse.json({ ok: true, authEnabled: false });
    }
    if (!body.password || !verifyPassword(body.password)) {
      return NextResponse.json(
        { ok: false, error: "Mot de passe incorrect" },
        { status: 401 }
      );
    }

    const token = createAuthToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return res;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Requête invalide" },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(AUTH_COOKIE_NAME);
  return res;
}
