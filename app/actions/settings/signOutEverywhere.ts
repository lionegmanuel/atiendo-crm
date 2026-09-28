"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { headers } from "next/headers";

export async function signOutEverywhere(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");

  await supabase.auth.signOut({ scope: "global" });

  if (user) {
    await audit({
      action: "auth.logout",
      actorUserId: user.id,
      requestId,
      metadata: { scope: "global" },
    });
  }
  redirect("/login");
}
