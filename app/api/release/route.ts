import { NextResponse } from "next/server";

import { SYSTEM_RELEASES } from "@/lib/update-log/system-data";

/** 当前部署的发布记录：公告、更新日志和拉取更新都读这一份 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { latest: SYSTEM_RELEASES[0] ?? null },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
