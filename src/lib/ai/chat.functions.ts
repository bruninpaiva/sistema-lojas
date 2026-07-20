import { createServerFn } from "@tanstack/react-start";

/**
 * Server function: canal único de comunicação com IA.
 * Preparado para futura integração com OpenAI / Gemini / Claude via LOVABLE_API_KEY.
 * Enquanto nenhum provedor estiver ativo, responde em modo MOCK.
 *
 * Observação: neste stack (TanStack Start) usamos server functions ao invés de
 * Edge Functions Supabase. Toda comunicação com IA passa exclusivamente por aqui
 * e nenhuma chave fica exposta no frontend.
 */

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

function mockReply(userText: string): string {
  const t = userText.toLowerCase();

  if (/vendeu mais.*hoje|mais vendeu hoje|top.*hoje/.test(t)) {
    return "Maria Oliveira realizou 18 vendas hoje totalizando R$ 8.240,00.";
  }
  if (/loja.*(mais|primeiro|top|faturamento|ranking)/.test(t)) {
    return "Ribeirão Shopping lidera as vendas hoje, seguido por Iguatemi e Novo Shopping.";
  }
  if (/motivo.*n[aã]o venda|n[aã]o vendeu/.test(t)) {
    return [
      "Principais motivos de não venda:",
      "• Não encontrou tamanho",
      "• Cliente apenas pesquisando",
      "• Produto indisponível",
    ].join("\n");
  }
  if (/convers[aã]o/.test(t)) {
    return "A conversão média do mês está em 38% — 4 p.p. acima do mês anterior.";
  }
  if (/sem vend|sem venda|n[aã]o vend/.test(t)) {
    return "3 funcionárias estão sem vendas registradas hoje. Recomendo revisar a fila de atendimento.";
  }
  if (/comparar|compare|junho|julho|m[eê]s anterior/.test(t)) {
    return "Julho está +12% em faturamento vs. Junho, com destaque para Ribeirão Shopping (+21%).";
  }
  if (/meta|hyper|super/.test(t)) {
    return "2 vendedoras bateram Hyper Meta e 5 bateram Super Meta neste mês.";
  }
  if (/atendimento/.test(t)) {
    return "Foram registrados 127 atendimentos hoje até o momento.";
  }

  return [
    "Ainda estou em modo demonstração (sem IA real conectada).",
    "Assim que o provedor for ativado, responderei com dados reais do sistema:",
    "vendas, lojas, metas, comissões, conversão e motivos de não venda.",
  ].join(" ");
}

export const aiChat = createServerFn({ method: "POST" })
  .inputValidator((input: AIChatRequest) => {
    if (!input || !Array.isArray(input.messages)) {
      throw new Error("messages required");
    }
    return input;
  })
  .handler(async ({ data }): Promise<AIChatResponse> => {
    const lastUser = [...data.messages].reverse().find((m) => m.role === "user");
    const userText = lastUser?.content ?? "";

    // TODO: quando LOVABLE_API_KEY estiver disponível, chamar via AI SDK aqui.
    // const key = process.env.LOVABLE_API_KEY;
    // if (key) { ...streamText / generateText... }

    return {
      reply: mockReply(userText),
      mock: true,
      provider: "mock",
    };
  });
