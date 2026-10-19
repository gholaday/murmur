"use client";

import { useState } from "react";

export function LoginForm({ setup }: { setup: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      {setup ? <p className="muted">This is the first account, so it can manage the library and other users.</p> : null}
      <label className="label">
        Username
        <input className="input" name="username" autoComplete="username" required />
      </label>
      <label className="label">
        Password
        <input
          className="input"
          name="password"
          type="password"
          autoComplete={setup ? "new-password" : "current-password"}
          minLength={setup ? 8 : 1}
          required
        />
      </label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="btn btn-primary btn-big" type="submit" disabled={busy}>
        {setup ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
