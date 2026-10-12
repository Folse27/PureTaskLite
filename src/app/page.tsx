import { connection } from "next/server";
import { PlannerApp } from "@/components/PlannerApp";
import { listLabels } from "@/lib/server/labels";
import { countsByDate } from "@/lib/server/tasks";

export default async function Home() {
  await connection(); // always render per request (data lives in Postgres)

  let initial;
  try {
    const [statuses, priorities, counts] = await Promise.all([
      listLabels("statuses"),
      listLabels("priorities"),
      countsByDate(),
    ]);
    initial = { statuses, priorities, counts };
  } catch (error) {
    console.error("[home] Could not load data:", error);
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
        <h1 className="text-[22px] font-semibold">Can’t reach the database</h1>
        <p className="mt-2 text-[15px] text-label-2">
          Check that DATABASE_URL is set to the Supabase transaction pooler connection string and that migrations have
          run. Details are in the server logs.
        </p>
      </main>
    );
  }

  return <PlannerApp initial={initial} />;
}
