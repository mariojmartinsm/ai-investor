import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPrivatePath, safeReturnPath } from "@/lib/auth/redirect";
import { authCookieOptions, getSupabaseConfig } from "@/lib/supabase/config";

function preventCaching(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = getSupabaseConfig();
  let authenticated = false;

  if (config) {
    const supabase = createServerClient(config.url, config.publishableKey, {
      cookieOptions: authCookieOptions,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
        },
      },
    });

    // Refresh immediately so both the downstream server and browser receive cookies.
    const { data, error } = await supabase.auth.getClaims();
    authenticated = !error && Boolean(data?.claims.sub) && data?.claims.is_anonymous !== true;
  }

  if (isPrivatePath(request.nextUrl.pathname) && !authenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", safeReturnPath(request.nextUrl.pathname));
    const redirected = NextResponse.redirect(url);
    // Preserve refresh/deletion cookies and cache headers when changing the response.
    for (const cookie of response.cookies.getAll()) redirected.cookies.set(cookie);
    for (const header of ["Cache-Control", "Pragma", "Expires"]) {
      const value = response.headers.get(header);
      if (value) redirected.headers.set(header, value);
    }
    response = redirected;
  }

  return preventCaching(response);
}
