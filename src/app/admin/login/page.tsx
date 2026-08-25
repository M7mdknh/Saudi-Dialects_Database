"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError("");
    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setStatus("error");
      setError("تعذّر تسجيل الدخول. تحقق من البريد الإلكتروني وكلمة المرور.");
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-center text-xl font-bold">تسجيل دخول المشرفين</h1>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {error ? (
          <p
            role="alert"
            className="border-danger bg-danger/10 text-danger rounded-lg border px-3 py-2 text-sm font-medium"
          >
            {error}
          </p>
        ) : null}
        <Field id="email" label="البريد الإلكتروني" required>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            dir="ltr"
          />
        </Field>
        <Field id="password" label="كلمة المرور" required>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            dir="ltr"
          />
        </Field>
        <Button
          type="submit"
          disabled={status === "loading"}
          className="w-full"
        >
          {status === "loading" ? "جارٍ الدخول…" : "دخول"}
        </Button>
      </form>
    </main>
  );
}
