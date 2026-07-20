import { createServerFn } from "@tanstack/react-start";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";

export type AIChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type AIChatRequest = {
  messages: AIChatMessage[];
};

export type AIChatResponse = {
  reply: string;
  mock: boolean;
  provider: string;
};

const SYSTEM_PROMPT = `Você é o Assistente IA do sistema Lupo — uma rede de lojas de moda íntima.
Responda em português do Brasil, de forma direta, objetiva e amistosa.

Você tem acesso a ferramentas para consultar o banco de dados em tempo real:
- list_stores: lista as lojas
- list_sales_reps: lista vendedoras (opcionalmente filtrando por loja)
- attendance_summary: resumo de atendimentos/vendas por período (hoje, mês, intervalo custom), com totais, conversão, ranking de vendedoras e ranking de lojas
- top_no_sale_reasons: principais motivos de não venda em um período
- commission_overview: visão geral de comissões importadas (mês/ano/loja)

Sempre que a pergunta envolver dados (vendas, ranking, conversão, metas, motivos, comissões, faturamento, vendedoras, lojas), USE as ferramentas antes de responder. Nunca invente números.
Quando não houver dados suficientes, diga isso claramente.
Formate valores em BRL (R$ 1.234,56) e datas em pt-BR quando fizer sentido.
Data/hora atual: ${new Date().toISOString()}`;

function todayRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  return { from, to };
}

function monthRange(year?: number, month?: number): { from: string; to: string } {
  const now = new Date();
  const y = year ?? now.getFullYear();
  const m = (month ?? now.getMonth() + 1) - 1;
  const from = new Date(y, m, 1).toISOString();
  const to = new Date(y, m + 1, 1).toISOString();
  return { from, to };
}

function resolveRange(input: {
  period?: "today" | "month" | "custom";
  year?: number;
  month?: number;
  from?: string;
  to?: string;
}): { from: string; to: string } {
  if (input.period === "custom" && input.from && input.to) {
    return { from: input.from, to: input.to };
  }
  if (input.period === "month" || input.year || input.month) {
    return monthRange(input.year, input.month);
  }
  return todayRange();
}

export const aiChat = createServerFn({ method: "POST" })
  .inputValidator((input: AIChatRequest) => {
    if (!input || !Array.isArray(input.messages)) throw new Error("messages required");
    return input;
  })
  .handler(async ({ data }): Promise<AIChatResponse> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      return {
        reply:
          "IA não configurada (LOVABLE_API_KEY ausente). Peça ao administrador para ativar o gateway de IA.",
        mock: true,
        provider: "none",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createLovableAiGateway } = await import("./gateway.server");

    const tools = {
      list_stores: tool({
        description: "Lista todas as lojas cadastradas.",
        inputSchema: z.object({}),
        execute: async () => {
          const { data, error } = await supabaseAdmin
            .from("stores")
            .select("id,name,active")
            .order("name");
          if (error) return { error: error.message };
          return { stores: data ?? [] };
        },
      }),

      list_sales_reps: tool({
        description: "Lista vendedoras (funcionárias). Opcionalmente filtra por nome da loja.",
        inputSchema: z.object({
          store_name: z.string().nullable().describe("Nome da loja para filtrar, ou null"),
        }),
        execute: async ({ store_name }) => {
          let storeId: string | null = null;
          if (store_name) {
            const { data: s } = await supabaseAdmin
              .from("stores")
              .select("id")
              .ilike("name", `%${store_name}%`)
              .maybeSingle();
            storeId = s?.id ?? null;
          }
          let q = supabaseAdmin
            .from("sales_reps")
            .select("id,name,active,queue_position,store_id")
            .order("queue_position");
          if (storeId) q = q.eq("store_id", storeId);
          const { data, error } = await q;
          if (error) return { error: error.message };
          return { reps: data ?? [] };
        },
      }),

      attendance_summary: tool({
        description:
          "Resumo de atendimentos e vendas em um período. Retorna totais, conversão, ranking de vendedoras e ranking de lojas. Use para perguntas de 'quem vendeu mais', 'ranking', 'conversão', 'faturamento', 'atendimentos'.",
        inputSchema: z.object({
          period: z.enum(["today", "month", "custom"]).describe("today, month ou custom"),
          year: z.number().int().nullable(),
          month: z.number().int().min(1).max(12).nullable(),
          from: z.string().nullable().describe("ISO datetime (custom)"),
          to: z.string().nullable().describe("ISO datetime (custom)"),
        }),
        execute: async (args) => {
          const { from, to } = resolveRange({
            period: args.period,
            year: args.year ?? undefined,
            month: args.month ?? undefined,
            from: args.from ?? undefined,
            to: args.to ?? undefined,
          });
          const { data: rows, error } = await supabaseAdmin
            .from("attendances")
            .select("id,type,amount,store_id,sales_rep_id,created_at")
            .gte("created_at", from)
            .lt("created_at", to);
          if (error) return { error: error.message };
          const all = rows ?? [];
          const vendas = all.filter((r: any) => r.type === "sale");
          const total = all.length;
          const totalVendas = vendas.length;
          const faturamento = vendas.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
          const conversao = total ? totalVendas / total : 0;

          const [{ data: reps }, { data: stores }] = await Promise.all([
            supabaseAdmin.from("sales_reps").select("id,name,store_id"),
            supabaseAdmin.from("stores").select("id,name"),
          ]);
          const repMap = new Map((reps ?? []).map((r: any) => [r.id, r]));
          const storeMap = new Map((stores ?? []).map((s: any) => [s.id, s.name]));

          const byRep = new Map<string, { name: string; store: string; vendas: number; faturamento: number; atendimentos: number }>();
          const byStore = new Map<string, { name: string; vendas: number; faturamento: number; atendimentos: number }>();
          for (const r of all) {
            const rep = repMap.get(r.sales_rep_id) as any;
            const repKey = r.sales_rep_id ?? "sem_rep";
            const repName = rep?.name ?? "—";
            const storeName = storeMap.get(r.store_id) ?? "—";
            const rb = byRep.get(repKey) ?? { name: repName, store: storeName, vendas: 0, faturamento: 0, atendimentos: 0 };
            rb.atendimentos += 1;
            if (r.type === "sale") {
              rb.vendas += 1;
              rb.faturamento += Number(r.amount ?? 0);
            }
            byRep.set(repKey, rb);

            const sb = byStore.get(r.store_id) ?? { name: storeName, vendas: 0, faturamento: 0, atendimentos: 0 };
            sb.atendimentos += 1;
            if (r.type === "sale") {
              sb.vendas += 1;
              sb.faturamento += Number(r.amount ?? 0);
            }
            byStore.set(r.store_id, sb);
          }
          const rankingReps = [...byRep.values()].sort((a, b) => b.faturamento - a.faturamento).slice(0, 20);
          const rankingLojas = [...byStore.values()].sort((a, b) => b.faturamento - a.faturamento);
          const semVendas = [...byRep.values()].filter((r) => r.vendas === 0).map((r) => ({ name: r.name, store: r.store }));

          return {
            periodo: { from, to },
            totais: {
              atendimentos: total,
              vendas: totalVendas,
              faturamento,
              conversao_pct: Math.round(conversao * 1000) / 10,
            },
            ranking_vendedoras: rankingReps,
            ranking_lojas: rankingLojas,
            vendedoras_sem_vendas: semVendas,
          };
        },
      }),

      top_no_sale_reasons: tool({
        description: "Top motivos de não venda (attendances com type != 'venda') em um período.",
        inputSchema: z.object({
          period: z.enum(["today", "month", "custom"]),
          year: z.number().int().nullable(),
          month: z.number().int().min(1).max(12).nullable(),
          from: z.string().nullable(),
          to: z.string().nullable(),
        }),
        execute: async (args) => {
          const { from, to } = resolveRange({
            period: args.period,
            year: args.year ?? undefined,
            month: args.month ?? undefined,
            from: args.from ?? undefined,
            to: args.to ?? undefined,
          });
          const { data, error } = await supabaseAdmin
            .from("attendances")
            .select("reason_id,type,created_at")
            .eq("type", "no_sale")
            .gte("created_at", from)
            .lt("created_at", to);
          if (error) return { error: error.message };
          const { data: reasons } = await supabaseAdmin
            .from("no_sale_reasons")
            .select("id,label");
          const map = new Map((reasons ?? []).map((r: any) => [r.id, r.label]));
          const counts = new Map<string, number>();
          for (const r of data ?? []) {
            const label = map.get(r.reason_id) ?? "Não informado";
            counts.set(label, (counts.get(label) ?? 0) + 1);
          }
          return {
            periodo: { from, to },
            motivos: [...counts.entries()]
              .map(([label, count]) => ({ label, count }))
              .sort((a, b) => b.count - a.count),
          };
        },
      }),

      commission_overview: tool({
        description: "Visão geral de importações de comissão (meta, faturamento, vendedoras) por mês/ano/loja.",
        inputSchema: z.object({
          year: z.number().int().nullable(),
          month: z.number().int().min(1).max(12).nullable(),
          store_name: z.string().nullable(),
        }),
        execute: async ({ year, month, store_name }) => {
          let q = supabaseAdmin
            .from("commission_imports")
            .select("id,store_id,month,year,meta_amount,updated_at,closed_at");
          if (year) q = q.eq("year", year);
          if (month) q = q.eq("month", month);
          const { data: imports, error } = await q;
          if (error) return { error: error.message };
          const { data: stores } = await supabaseAdmin.from("stores").select("id,name");
          const storeMap = new Map((stores ?? []).map((s: any) => [s.id, s.name]));
          let filtered = imports ?? [];
          if (store_name) {
            const nameLc = store_name.toLowerCase();
            filtered = filtered.filter((i: any) =>
              (storeMap.get(i.store_id) ?? "").toLowerCase().includes(nameLc),
            );
          }
          const enriched = await Promise.all(
            filtered.map(async (i: any) => {
              const { data: rows } = await supabaseAdmin
                .from("commission_rows")
                .select("nome,liquido,vendas,uni,consentimentos")
                .eq("import_id", i.id);
              const totalLiquido = (rows ?? []).reduce((s, r: any) => s + Number(r.liquido ?? 0), 0);
              return {
                loja: storeMap.get(i.store_id) ?? "—",
                mes: i.month,
                ano: i.year,
                meta: Number(i.meta_amount ?? 0),
                faturamento_liquido: totalLiquido,
                atingimento_pct: i.meta_amount
                  ? Math.round((totalLiquido / Number(i.meta_amount)) * 1000) / 10
                  : null,
                funcionarias: (rows ?? []).length,
                fechado: !!i.closed_at,
                top: [...(rows ?? [])]
                  .sort((a: any, b: any) => Number(b.liquido) - Number(a.liquido))
                  .slice(0, 5)
                  .map((r: any) => ({ nome: r.nome, liquido: Number(r.liquido) })),
              };
            }),
          );
          return { importacoes: enriched };
        },
      }),
    };

    const gateway = createLovableAiGateway(key);
    const model = gateway("google/gemini-2.5-flash");

    try {
      const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        messages: data.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })) as any,
        tools,
        stopWhen: stepCountIs(8),
      });
      return {
        reply: result.text || "Não consegui gerar uma resposta.",
        mock: false,
        provider: "lovable/gemini-2.5-flash",
      };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      return {
        reply: `Erro ao consultar a IA: ${msg}`,
        mock: true,
        provider: "error",
      };
    }
  });
