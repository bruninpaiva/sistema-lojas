import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getPublicSupabase } from "../supabase";

export default defineTool({
  name: "attendance_summary",
  title: "Resumo de atendimentos",
  description:
    "Retorna totais de atendimentos e conversão em um período (start_date/end_date, formato YYYY-MM-DD). Filtros opcionais por store_id e rep_id.",
  inputSchema: {
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Data inicial YYYY-MM-DD."),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Data final YYYY-MM-DD."),
    store_id: z.string().uuid().optional(),
    rep_id: z.string().uuid().optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ start_date, end_date, store_id, rep_id }) => {
    const supabase = getPublicSupabase();
    let query = supabase
      .from("attendances")
      .select("id, store_id, rep_id, sold, created_at")
      .gte("created_at", `${start_date}T00:00:00.000Z`)
      .lte("created_at", `${end_date}T23:59:59.999Z`);
    if (store_id) query = query.eq("store_id", store_id);
    if (rep_id) query = query.eq("rep_id", rep_id);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = data ?? [];
    const total = rows.length;
    const sold = rows.filter((r) => r.sold).length;
    const conversion = total > 0 ? sold / total : 0;
    const summary = {
      start_date,
      end_date,
      total_attendances: total,
      sold,
      not_sold: total - sold,
      conversion_rate: Number(conversion.toFixed(4)),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(summary) }],
      structuredContent: summary,
    };
  },
});
