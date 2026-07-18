import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Crown,
  Lock,
  Utensils,
  LogOut,
  CheckCircle2,
  GripVertical,
  HandMetal,
  Coffee,
  Bath,
  Briefcase,
  X,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import lupoLogo from "@/assets/lupo-logo.png.asset.json";

export const Route = createFileRoute("/loja/$storeId/")({
  component: LojaHome,
});

type Rep = { id: string; name: string; queue_position: number | null; status: string };
type Store = { id: string; name: string };

const pinKey = (id: string) => `lupo_store_pin_ok_${id}`;

function LojaHome() {
  const { storeId } = Route.useParams();
  const [store, setStore] = useState<Store | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [unlocked, setUnlocked] = useState<boolean>(() =>
    typeof window !== "undefined" && sessionStorage.getItem(pinKey(storeId)) === "1"
  );

  useEffect(() => {
    supabase
      .from("stores")
      .select("id,name")
      .eq("id", storeId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) setNotFound(true);
        else setStore(data as Store);
      });
  }, [storeId]);

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md rounded-2xl bg-card p-6 text-center shadow">
          <p className="mb-4 text-lg font-semibold">Loja não encontrada.</p>
          <Link to="/" className="rounded-xl bg-brand px-5 py-2 font-bold text-brand-foreground">
            Voltar
          </Link>
        </div>
      </div>
    );
  }
  if (!store) return <p className="p-8 text-center text-muted-foreground">Carregando…</p>;

  if (!unlocked) {
    return (
      <PinGate
        store={store}
        onOk={() => {
          sessionStorage.setItem(pinKey(storeId), "1");
          setUnlocked(true);
        }}
      />
    );
  }

  return <Queue store={store} />;
}

function PinGate({ store, onOk }: { store: Store; onOk: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    const { data, error: rpcErr } = await supabase.rpc("verify_store_pin", {
      _store_id: store.id,
      _pin: pin,
    });
    setChecking(false);
    if (!rpcErr && data === true) {
      onOk();
    } else {
      setError(true);
      setPin("");
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="flex items-center gap-3 bg-brand px-4 py-4 text-brand-foreground">
        <Link to="/" className="rounded-lg p-2 hover:bg-white/10" aria-label="Voltar">
          <ArrowLeft size={24} />
        </Link>
        <div className="flex items-center rounded-lg bg-white px-2.5 py-1">
          <img src={lupoLogo.url} alt="Lupo" className="h-6 w-auto" />
        </div>
        <h1 className="text-lg font-bold">{store.name}</h1>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <form
          onSubmit={submit}
          className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg border-t-4 border-brand"
        >
          <div className="mb-5 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Lock size={26} />
            </div>
            <h2 className="text-xl font-extrabold">{store.name}</h2>
            <p className="text-sm text-muted-foreground">Digite o PIN da loja</p>
          </div>
          <input
            autoFocus
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ""));
              setError(false);
            }}
            className="mb-3 w-full rounded-xl border-2 border-border bg-background px-4 py-4 text-center text-3xl tracking-[0.5em] font-bold"
            placeholder="••••"
          />
          {error && <p className="mb-3 text-center text-sm font-semibold text-destructive">PIN incorreto.</p>}
          <button
            type="submit"
            className="w-full rounded-xl bg-brand px-6 py-4 text-lg font-bold text-brand-foreground"
          >
            Entrar
          </button>
        </form>
      </main>
    </div>
  );
}

function DraggableRep({ rep, badge }: { rep: Rep; badge?: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: rep.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
      className="flex items-center gap-3 rounded-2xl border-2 border-border bg-card px-4 py-4 shadow-sm cursor-grab active:cursor-grabbing select-none"
    >
      <GripVertical size={22} className="text-muted-foreground shrink-0" />
      {badge}
      <span className="flex-1 text-lg sm:text-xl font-semibold text-foreground break-words">{rep.name}</span>
    </div>
  );
}

function Queue({ store }: { store: Store }) {
  const navigate = useNavigate();
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [offPickerFor, setOffPickerFor] = useState<Rep | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );

  const load = () => {
    supabase
      .from("sales_reps")
      .select("id,name,queue_position,status")
      .eq("active", true)
      .eq("store_id", store.id)
      .order("queue_position", { ascending: true })
      .then(({ data }) => {
        setReps((data ?? []) as Rep[]);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const inService = reps.filter((r) => r.status === "in_service");
  const available = reps.filter((r) => r.status === "available");
  const onLunch = reps.filter((r) => r.status === "lunch");
  const off = reps.filter((r) => r.status === "off");

  const setStatus = async (
    rep: Rep,
    status: "available" | "lunch" | "off" | "in_service",
    opts?: { sendToEnd?: boolean; silent?: boolean; message?: string; startBreakReason?: string; closeBreak?: boolean },
  ) => {
    const prevStatus = rep.status;
    const { error } = await supabase.from("sales_reps").update({ status }).eq("id", rep.id);
    if (error) {
      console.error("update status error", error);
      return toast.error("Erro ao atualizar status");
    }

    // Close any open break when leaving lunch/off
    const leavingBreak = (prevStatus === "lunch" || prevStatus === "off") && status !== prevStatus;
    if (leavingBreak || opts?.closeBreak) {
      const { error: closeErr } = await supabase
        .from("rep_breaks")
        .update({ ended_at: new Date().toISOString() })
        .eq("sales_rep_id", rep.id)
        .is("ended_at", null);
      if (closeErr) console.error("close break error", closeErr);
    }

    // Open a break record when entering lunch/off
    if ((status === "lunch" || status === "off") && prevStatus !== status) {
      const reason = opts?.startBreakReason ?? (status === "lunch" ? "Almoço" : "Fora");
      const { error: insErr } = await supabase.from("rep_breaks").insert({
        sales_rep_id: rep.id,
        store_id: store.id,
        break_type: status === "lunch" ? "lunch" : "off",
        reason,
      });
      if (insErr) console.error("insert break error", insErr);
    }

    if (opts?.sendToEnd) {
      await supabase.rpc("send_to_end_of_queue", { _rep_id: rep.id });
    }
    if (!opts?.silent) toast.success(opts?.message ?? "Atualizado");
    load();
  };

  const onDragStart = (e: DragStartEvent) => setActiveDragId(String(e.active.id));
  const onDragEnd = async (e: DragEndEvent) => {
    setActiveDragId(null);
    if (!e.over) return;
    const repId = String(e.active.id);
    const rep = reps.find((r) => r.id === repId);
    if (!rep) return;
    if (e.over.id === "in-service" && rep.status !== "in_service") {
      await setStatus(rep, "in_service", { message: `${rep.name} em atendimento` });
    }
  };

  const activeDragRep = activeDragId ? reps.find((r) => r.id === activeDragId) : null;

  const exitStore = () => {
    sessionStorage.removeItem(pinKey(store.id));
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="flex items-center justify-between bg-brand px-4 py-4 text-brand-foreground shadow-md gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={exitStore} className="rounded-lg p-2 hover:bg-white/10 shrink-0" aria-label="Trocar loja">
            <ArrowLeft size={22} />
          </button>
          <div className="flex items-center rounded-lg bg-white px-2.5 py-1 shrink-0">
            <img src={lupoLogo.url} alt="Lupo" className="h-6 w-auto" />
          </div>
          <div className="min-w-0">
            <p className="text-xs opacity-80 truncate">Loja</p>
            <h1 className="text-lg font-bold truncate">{store.name}</h1>
          </div>
        </div>
        <Link
          to="/admin"
          className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20 shrink-0"
        >
          <BarChart3 size={18} /> Admin
        </Link>
      </header>

      <main className="flex-1 p-4 md:p-8">
        {loading ? (
          <p className="text-center text-muted-foreground">Carregando…</p>
        ) : reps.length === 0 ? (
          <p className="mx-auto max-w-md rounded-xl bg-muted p-6 text-center text-muted-foreground">
            Nenhuma vendedora cadastrada nesta loja. Vá em <span className="font-semibold">Admin</span> para cadastrar.
          </p>
        ) : (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="mx-auto max-w-6xl space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                <section>
                  <p className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                    <Crown size={16} className="text-brand" /> Fila de espera
                  </p>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Arraste a vendedora para <strong>Em atendimento →</strong>
                  </p>
                  {available.length === 0 ? (
                    <div className="rounded-2xl bg-muted p-6 text-center text-muted-foreground">
                      Nenhuma vendedora disponível na fila.
                    </div>
                  ) : (
                    <ol className="space-y-2">
                      {available.map((r, idx) => (
                        <li key={r.id}>
                          <DraggableRep
                            rep={r}
                            badge={
                              <span
                                className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-extrabold shrink-0 ${
                                  idx === 0
                                    ? "bg-brand text-brand-foreground"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {idx + 1}
                              </span>
                            }
                          />
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                              onClick={() =>
                                setStatus(r, "lunch", {
                                  message: `${r.name} está almoçando`,
                                  startBreakReason: "Almoço",
                                })
                              }
                              className="flex items-center justify-center gap-2 rounded-lg border border-amber-400 bg-amber-50 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                            >
                              <Utensils size={16} /> Almoço
                            </button>
                            <button
                              onClick={() => setOffPickerFor(r)}
                              className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted py-2 text-sm font-semibold text-foreground hover:bg-muted/70"
                            >
                              <LogOut size={16} /> Fora
                            </button>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>

                <InServiceDropZone
                  inService={inService}
                  isDragging={!!activeDragId}
                  onTapRep={(rep) =>
                    navigate({
                      to: "/loja/$storeId/vendedora/$repId",
                      params: { storeId: store.id, repId: rep.id },
                    })
                  }
                  onBackToQueue={(rep) =>
                    setStatus(rep, "available", { message: `${rep.name} voltou para a fila` })
                  }
                />
              </div>


              {onLunch.length > 0 && (
                <section>
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-amber-700">
                    <Utensils size={16} /> Almoçando
                  </h2>
                  <ul className="space-y-2">
                    {onLunch.map((r) => (
                      <BreakRow
                        key={r.id}
                        rep={r}
                        variant="lunch"
                        onReturn={() =>
                          setStatus(r, "available", {
                            sendToEnd: true,
                            closeBreak: true,
                            message: `${r.name} voltou do almoço`,
                          })
                        }
                        returnLabel="Voltei do almoço"
                      />
                    ))}
                  </ul>
                </section>
              )}

              {off.length > 0 && (
                <section>
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                    <LogOut size={16} /> Fora da loja
                  </h2>
                  <ul className="space-y-2">
                    {off.map((r) => (
                      <BreakRow
                        key={r.id}
                        rep={r}
                        variant="off"
                        onReturn={() =>
                          setStatus(r, "available", {
                            sendToEnd: true,
                            closeBreak: true,
                            message: `${r.name} chegou na loja`,
                          })
                        }
                        returnLabel="Cheguei na loja"
                      />
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <DragOverlay>
              {activeDragRep ? (
                <div className="flex items-center gap-3 rounded-2xl border-2 border-brand bg-card px-4 py-4 shadow-2xl">
                  <GripVertical size={22} className="text-brand" />
                  <span className="text-xl font-semibold text-foreground">{activeDragRep.name}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      {offPickerFor && (
        <OffReasonModal
          rep={offPickerFor}
          onClose={() => setOffPickerFor(null)}
          onPick={async (reason) => {
            const rep = offPickerFor;
            setOffPickerFor(null);
            await setStatus(rep, "off", {
              message: `${rep.name} saiu — ${reason}`,
              startBreakReason: reason,
            });
          }}
        />
      )}
    </div>
  );
}

function BreakRow({
  rep,
  variant,
  onReturn,
  returnLabel,
}: {
  rep: Rep;
  variant: "lunch" | "off";
  onReturn: () => void;
  returnLabel: string;
}) {
  const [info, setInfo] = useState<{ started_at: string; reason: string | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    supabase
      .from("rep_breaks")
      .select("started_at,reason")
      .eq("sales_rep_id", rep.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(async ({ data }) => {
        if (data) {
          setInfo(data);
        } else {
          // Backfill: rep is in lunch/off but has no open break record.
          const reason = variant === "lunch" ? "Almoço" : "Fora";
          const started_at = new Date().toISOString();
          const { data: inserted } = await supabase
            .from("rep_breaks")
            .insert({
              sales_rep_id: rep.id,
              break_type: variant,
              reason,
              started_at,
            })
            .select("started_at,reason")
            .maybeSingle();
          setInfo(inserted ?? { started_at, reason });
        }
      });
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [rep.id, variant]);

  const elapsed = info ? Math.max(0, Math.floor((now - new Date(info.started_at).getTime()) / 60000)) : 0;
  const elapsedLabel = elapsed < 60 ? `${elapsed} min` : `${Math.floor(elapsed / 60)}h ${elapsed % 60}min`;

  const isLunch = variant === "lunch";

  return (
    <li
      className={`flex flex-wrap items-center gap-3 rounded-2xl px-5 py-4 ${
        isLunch ? "border-2 border-amber-300 bg-amber-50" : "border border-border bg-muted"
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className={`text-xl font-semibold ${isLunch ? "text-amber-950" : "text-foreground"}`}>{rep.name}</p>
        <p className={`text-xs ${isLunch ? "text-amber-800" : "text-muted-foreground"}`}>
          {info?.reason ?? (isLunch ? "Almoço" : "Fora")} · há {elapsedLabel}
        </p>
      </div>
      <button
        onClick={onReturn}
        className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-brand-foreground hover:brightness-110"
      >
        <CheckCircle2 size={16} /> {returnLabel}
      </button>
    </li>
  );
}

function OffReasonModal({
  rep,
  onClose,
  onPick,
}: {
  rep: Rep;
  onClose: () => void;
  onPick: (reason: string) => void;
}) {
  const options = [
    { label: "Sair para café", icon: Coffee },
    { label: "Sair para banheiro", icon: Bath },
    { label: "Tarefa externa", icon: Briefcase },
    { label: "Fora horário de trabalho", icon: LogOut },
  ];
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Fora da loja</p>
            <h3 className="text-xl font-extrabold">{rep.name}</h3>
            <p className="text-sm text-muted-foreground">Qual o motivo?</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted" aria-label="Fechar">
            <X size={22} />
          </button>
        </div>
        <div className="space-y-2">
          {options.map(({ label, icon: Icon }) => (
            <button
              key={label}
              onClick={() => onPick(label)}
              className="flex w-full items-center gap-3 rounded-xl border-2 border-border bg-background px-4 py-4 text-left text-lg font-semibold hover:border-brand hover:bg-brand/5 active:scale-[0.98]"
            >
              <Icon size={22} className="text-brand shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function InServiceDropZone({
  inService,
  isDragging,
  onTapRep,
  onBackToQueue,
}: {
  inService: Rep[];
  isDragging: boolean;
  onTapRep: (rep: Rep) => void;
  onBackToQueue: (rep: Rep) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "in-service" });
  return (
    <section
      ref={setNodeRef}
      className={`rounded-3xl border-4 border-dashed p-4 transition ${
        isOver
          ? "border-brand bg-brand/10"
          : isDragging
            ? "border-brand/60 bg-brand/5"
            : "border-border bg-card"
      }`}
    >
      <p className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-brand">
        <HandMetal size={16} /> Em atendimento
      </p>
      {inService.length === 0 ? (
        <div className="rounded-2xl bg-muted/50 p-6 text-center text-muted-foreground">
          Arraste uma vendedora da fila para cá quando iniciar o atendimento.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {inService.map((rep) => (
            <div key={rep.id} className="flex flex-col gap-2">
              <button
                onClick={() => onTapRep(rep)}
                className="flex min-h-[140px] flex-col items-center justify-center rounded-2xl bg-brand px-4 py-6 text-brand-foreground shadow-xl active:scale-[0.98] hover:brightness-110"
              >
                <span className="text-3xl md:text-4xl font-extrabold text-center">{rep.name}</span>
                <span className="mt-2 text-sm opacity-90">Toque para finalizar</span>
              </button>
              <button
                onClick={() => onBackToQueue(rep)}
                className="rounded-lg border border-border bg-card py-2 text-sm font-semibold text-foreground hover:bg-muted"
              >
                Voltar para a fila
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
