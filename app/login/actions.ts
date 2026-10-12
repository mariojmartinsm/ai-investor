"use server";

import { redirect } from "next/navigation";
import { safeReturnPath } from "@/lib/auth/redirect";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null };

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const failure = { error: "Unable to sign in. Check your email and password and try again." };

  if (typeof email !== "string" || typeof password !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254 ||
      password.length === 0 || password.length > 1024) {
    return failure;
  }
  if (!getSupabaseConfig()) return { error: "Sign-in is currently unavailable. Please contact the workspace owner." };

  const supabase = await createServerSupabaseClient({ writeCookies: true });
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.user || data.user.is_anonymous) return failure;

  redirect(safeReturnPath(formData.get("next")));
}
