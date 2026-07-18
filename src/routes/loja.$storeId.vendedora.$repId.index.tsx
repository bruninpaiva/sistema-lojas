import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ShoppingBag, XCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/loja/$storeId/vendedora/$repId/")({
  component: ActionPage,
});

function ActionPage() {
  const { storeId, repId } = Route.useParams();
  const navigate = useNavigate();
  const [name, setName] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("sales_reps").select("name,store_id").eq("id", repId).maybeSingle().then(({ data }) => {
      if (!data || data.store_id !== storeId) {
        navigate({ to: "/loja/$storeId", params: { storeId }, replace: true });
      } else {
        setName(data.name);
      }
    });
  }, [storeId, repId, navigate]);

  const registerSale = async () => {
    if (saving) return;
    setSaving(true);
    const { error } = await supabase.from("attendances").insert({
      sales_rep_id: repId,
      store_id: storeId,
      type: "sale",
    });
    if (error) {
      setSaving(false);
      toast.error("Erro ao registrar. Tente novamente.");
      return;
    }
    await supabase.from("sales_reps").update({ status: "available" }).eq("id", repId);
    await supabase.rpc("send_to_end_of_queue", { _rep_id: repId });
    toast.success("Venda registrada!");
    navigate({ to: "/loja/$storeId", params: { storeId }, replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="flex items-center gap-3 bg-brand px-4 py-4 text-brand-foreground shadow-md">
        <Link
          to="/loja/$storeId"
          params={{ storeId }}
          className="rounded-lg p-2 hover:bg-white/10"
          aria-label="Voltar"
        >
          <ArrowLeft size={24} />
        </Link>
        <div>
          <p className="text-xs opacity-80">Vendedora</p>
          <h1 className="text-xl font-bold">{name || "…"}</h1>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 p-6 md:p-10">
        <button
          type="button"
          onClick={registerSale}
          disabled={saving}
          className="flex flex-col items-center justify-center rounded-3xl bg-success text-success-foreground shadow-xl transition active:scale-[0.98] hover:brightness-110 min-h-[260px] disabled:opacity-70"
        >
          {saving ? (
            <Loader2 className="mb-6 animate-spin" size={110} strokeWidth={1.5} />
          ) : (
            <ShoppingBag className="mb-6" size={110} strokeWidth={1.5} />
          )}
          <span className="text-3xl md:text-5xl font-extrabold tracking-tight">
            {saving ? "REGISTRANDO…" : "VENDA REALIZADA"}
          </span>
        </button>

        <Link
          to="/loja/$storeId/vendedora/$repId/nao-vendeu"
          params={{ storeId, repId }}
          className="flex flex-col items-center justify-center rounded-3xl bg-destructive text-destructive-foreground shadow-xl transition active:scale-[0.98] hover:brightness-110 min-h-[260px]"
        >
          <XCircle className="mb-6" size={110} strokeWidth={1.5} />
          <span className="text-3xl md:text-5xl font-extrabold tracking-tight">NÃO VENDEU</span>
        </Link>
      </main>
    </div>
  );
}
