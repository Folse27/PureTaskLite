import "server-only";
import { sql } from "drizzle-orm";
import { schema, type Transaction } from "@/lib/db";

type OrderedTable = typeof schema.tasks | typeof schema.statuses | typeof schema.priorities;

/**
 * Sets sort_order = position for every id in one UPDATE … FROM (VALUES …)
 * statement, touching only rows whose order actually changes.
 */
export async function setSortOrders(
  tx: Transaction,
  table: OrderedTable,
  orderedIds: readonly string[],
): Promise<void> {
  if (orderedIds.length === 0) return;
  const values = sql.join(
    orderedIds.map((id, index) => sql`(${id}::uuid, ${index}::int)`),
    sql`, `,
  );
  await tx.execute(sql`
    update ${table} set sort_order = v.position
    from (values ${values}) as v(id, position)
    where ${table.id} = v.id and ${table.sortOrder} is distinct from v.position`);
}
