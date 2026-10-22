import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getDMQueue, getRedisConnection } from "@/lib/queue/client";
import { getWorkerHealth } from "@/lib/ops/worker-health";

export const runtime = "nodejs";
// Health must reflect live state (worker heartbeat), never a cached response.
export const dynamic = "force-dynamic";

// This endpoint is public, so it reports only pass/fail per component. Error
// messages, hostnames, pids and queue counts stay server side; signed-in
// admins can see the detail on the Diagnostics page.

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error("[health] database check failed", error);
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    return (await getRedisConnection().ping()) === "PONG";
  } catch (error) {
    console.error("[health] redis check failed", error);
    return false;
  }
}

async function checkQueue(): Promise<boolean> {
  try {
    await getDMQueue().getJobCounts("waiting");
    return true;
  } catch (error) {
    console.error("[health] queue check failed", error);
    return false;
  }
}

async function checkWorker(): Promise<boolean> {
  try {
    return (await getWorkerHealth()).healthy;
  } catch (error) {
    console.error("[health] worker check failed", error);
    return false;
  }
}

export async function GET() {
  const [database, redis, queue, worker] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkQueue(),
    checkWorker(),
  ]);

  const healthy = database && redis && queue && worker;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: {
        database: { ok: database },
        redis: { ok: redis },
        queue: { ok: queue },
        worker: { ok: worker, healthy: worker },
      },
    },
    { status: healthy ? 200 : 503 }
  );
}
