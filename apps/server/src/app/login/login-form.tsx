"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "@/web/icons";

export function LoginForm({ setup }: { setup: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password"), client: "web" }),
    });
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? "Couldn't sign in. Try again.");
    setBusy(false);
  }

  return (
    <form className="login" onSubmit={onSubmit}>
      <h1>{setup ? "Create your admin account" : "Sign in to Murmur"}</h1>
      <label className="label">
        Username
        <input className="input" name="username" autoComplete="username" required />
      </label>
      <label className="label">
        Password
        <span className="input-with-button">
          <input
            className="input"
            name="password"
            type={shown ? "text" : "password"}
            autoComplete={setup ? "new-password" : "current-password"}
            minLength={setup ? 8 : 1}
            required
          />
          <button type="button" className="icon-btn" aria-label={shown ? "Hide password" : "Show password"} onClick={() => setShown((s) => !s)}>
            {shown ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
          </button>
        </span>
      </label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="btn btn-primary btn-big" type="submit" disabled={busy}>
        {setup ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
