"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { User } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Check,
  ClipboardPaste,
  LogIn,
  NotebookPen,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  extractMail,
  remainingLabel,
  reminderTimes,
  sampleDeadlines,
  sampleMail,
  sortDeadlines,
  validateDeadline,
  type Deadline,
  type DeadlineInput,
  type MailCandidates,
} from "@/lib/deadlines";
import { appError, getSupabase } from "@/lib/supabase";
import { currentSubscription, pushSupported, subscribePush } from "@/lib/push";

type View = "list" | "add" | "settings" | "auth";
const blank: DeadlineInput = {
  company: "",
  task: "",
  due_date: "",
  due_time: null,
  submission_url: null,
  status: "pending",
};

export default function DeadlineApp() {
  const [view, setView] = useState<View>("list");
  const [user, setUser] = useState<User | null>(null);
  const [configured, setConfigured] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<Deadline[]>([]);
  const [demo, setDemo] = useState<Deadline[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("pending");
  const [selected, setSelected] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("deadline"),
  );
  const [editing, setEditing] = useState<Deadline | null>(null);
  const [stagedMail, setStagedMail] = useState("");
  const [formVersion, setFormVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const activeUser = useRef<string | null>(null);
  const detailOpener = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    let disposed = false;
    const initialise = async () => {
      setDemo(sampleDeadlines());
      if (supabase) {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (disposed) return;
        setConfigured(true);
        if (sessionError) setError(appError(sessionError));
        activeUser.current = data.session?.user.id ?? null;
        setLoading(!!data.session);
        setUser(data.session?.user ?? null);
      }
      if (!disposed) setChecking(false);
    };
    void initialise();
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      activeUser.current = session?.user.id ?? null;
      setRecords([]);
      setSelected(
        event === "SIGNED_OUT"
          ? null
          : new URLSearchParams(window.location.search).get("deadline"),
      );
      setLoading(!!session);
      setUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") {
        setRecovery(true);
        setView("auth");
      }
    });
    return () => {
      disposed = true;
      subscription?.data.subscription.unsubscribe();
    };
  }, []);

  const refresh = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase || !user) return;
    const id = user.id;
    const { data, error: readError } = await supabase
      .from("deadlines")
      .select(
        "id,company,task,due_date,due_time,submission_url,status,revision,updated_at",
      )
      .order("due_date")
      .order("due_time");
    if (activeUser.current !== id) return;
    if (readError) setError(appError(readError));
    else {
      setRecords(
        (data ?? []).map((item) => ({
          ...item,
          due_time: item.due_time?.slice(0, 5) ?? null,
        })) as Deadline[],
      );
      setError("");
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    // 認証した利用者のサーバーデータを取得する。状態の更新は非同期の応答後に行う。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const onFocus = () => {
      if (user) {
        setLoading(true);
        void refresh();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh, user]);

  const all = sortDeadlines(user ? records : demo);
  const detail = all.find((item) => item.id === selected);
  const shown = all.filter((item) => item.status === filter);

  const startAdding = useCallback((mail = "") => {
    setEditing(null);
    setStagedMail(mail);
    setFormVersion((value) => value + 1);
    setError("");
    setView("add");
  }, []);

  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: object,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tool = {
      name: "prepare_deadline_from_email",
      title: "メールから締切候補を準備",
      description:
        "メール本文を端末内で候補化し、確認画面を開く。保存や通知予約は行わない。",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", minLength: 1, maxLength: 20000 },
        },
        required: ["text"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute(input: unknown) {
        if (
          !input ||
          typeof input !== "object" ||
          !("text" in input) ||
          typeof input.text !== "string" ||
          Object.keys(input).length !== 1
        )
          throw new Error("textだけを指定してください。");
        const candidates = extractMail(input.text);
        startAdding(input.text);
        return {
          staged: true,
          saved: false,
          dateCandidates: candidates.dates.length,
          needsConfirmation: true,
        };
      },
    };
    void Promise.resolve(
      context.registerTool(tool, { signal: lifecycle.signal }),
    ).catch(() => {
      /* 非対応でも画面操作は利用できる。 */
    });
    return () => lifecycle.abort();
  }, [startAdding]);

  async function save(input: DeadlineInput, newId: string): Promise<boolean> {
    setBusy(true);
    setError("");
    const data = {
      ...input,
      company: input.company.trim(),
      task: input.task.trim(),
      submission_url: input.submission_url?.trim() || null,
    };
    try {
      if (user) {
        const supabase = getSupabase()!;
        const query = editing
          ? supabase
              .from("deadlines")
              .update(data)
              .eq("id", editing.id)
              .eq("revision", editing.revision)
          : supabase
              .from("deadlines")
              .upsert(
                { ...data, id: newId, owner_id: user.id },
                { onConflict: "id" },
              );
        const { data: saved, error: saveError } = await query
          .select(
            "id,company,task,due_date,due_time,submission_url,status,revision,updated_at",
          )
          .single();
        if (activeUser.current !== user.id) return false;
        if (saveError) {
          if (saveError.code === "PGRST116")
            throw new Error(
              "別の端末で変更された可能性があります。一覧を更新して、最新の内容から編集してください。入力は残っています。",
            );
          throw saveError;
        }
        setRecords((items) => [
          ...items.filter((item) => item.id !== saved.id),
          {
            ...saved,
            due_time: saved.due_time?.slice(0, 5) ?? null,
          } as Deadline,
        ]);
      } else {
        const entry = {
          ...data,
          id: editing?.id ?? newId,
          revision: (editing?.revision ?? 0) + 1,
          updated_at: new Date().toISOString(),
        };
        setDemo((items) => [
          ...items.filter((item) => item.id !== entry.id),
          entry,
        ]);
      }
      setStagedMail("");
      setEditing(null);
      setFilter(input.status);
      setView("list");
      toast.success(
        user
          ? "締切を保存しました"
          : "サンプルに追加しました。この情報は再読み込みで消えます。",
      );
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message.startsWith("別の端末")
          ? failure.message
          : appError(failure),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggleSubmitted(item: Deadline) {
    setBusy(true);
    setError("");
    const status = item.status === "pending" ? "submitted" : "pending";
    if (user) {
      const { data, error: updateError } = await getSupabase()!
        .from("deadlines")
        .update({ status })
        .eq("id", item.id)
        .eq("revision", item.revision)
        .select("id,status,revision,updated_at")
        .single();
      if (updateError) {
        setError(appError(updateError));
        setBusy(false);
        return;
      }
      setRecords((items) =>
        items.map((entry) =>
          entry.id === item.id ? { ...entry, ...data } : entry,
        ),
      );
    } else
      setDemo((items) =>
        items.map((entry) =>
          entry.id === item.id
            ? { ...entry, status, revision: entry.revision + 1 }
            : entry,
        ),
      );
    setSelected(null);
    setBusy(false);
    toast.success(
      status === "submitted"
        ? user
          ? "提出済みにしました。今後の締切通知は止まります。"
          : "サンプルを提出済みにしました。"
        : "未提出に戻しました。",
    );
  }

  async function signOut() {
    setBusy(true);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        await getSupabase()!
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", subscription.endpoint);
      }
      const { error: signOutError } = await getSupabase()!.auth.signOut();
      if (signOutError) throw signOutError;
      activeUser.current = null;
      setRecords([]);
      setSelected(null);
      setUser(null);
      setView("list");
      setDemo(sampleDeadlines());
    } catch (failure) {
      setError(appError(failure));
    } finally {
      setBusy(false);
    }
  }

  function closeDetail() {
    setSelected(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("deadline");
    window.history.replaceState(null, "", url.pathname + url.search);
  }

  function navigate(next: View) {
    setStagedMail("");
    setEditing(null);
    setError("");
    setView(next);
  }

  return (
    <>
      <a className="skip-link" href="#main">
        本文へ移動
      </a>
      <header className="app-header">
        <button
          className="brand brand-button"
          onClick={() => navigate("list")}
          aria-label="締切ノートの一覧へ"
        >
          <span className="brand-icon">
            <NotebookPen aria-hidden="true" />
          </span>
          <span>
            締切ノート
            <span className="brand-caption">就活の、次の一歩を。</span>
          </span>
        </button>
        <Button variant="ghost" onClick={() => navigate("settings")}>
          <Bell aria-hidden="true" />
          通知とアカウント
        </Button>
      </header>
      <main id="main" className="workspace">
        {!user && !checking && (
          <div className="demo-notice">
            <span className="status-dot" />
            企業向けデモ{" "}
            <span>
              架空データで操作できます。変更は保存・同期されません。実際のメールは貼り付けないでください。
            </span>
          </div>
        )}
        {user && (
          <p className="notice-line">
            <span className="small-badge">オンラインで保存</span>{" "}
            同じアカウントでスマホとPCから使えます。
          </p>
        )}
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        {view === "list" && (
          <>
            <div className="page-heading">
              <div>
                <p className="eyebrow">YOUR NEXT STEP</p>
                <h1>締切を、ひとつの場所に。</h1>
                <p className="subtitle">
                  何を、いつまでに、どこから。提出に必要な情報をまとめて確認。
                </p>
              </div>
              <Button className="primary-action" onClick={() => startAdding()}>
                <Plus aria-hidden="true" />
                {user ? "メールから追加" : "サンプルで試す"}
              </Button>
            </div>
            <Tabs value={filter} onValueChange={setFilter}>
              <div className="section-heading">
                <TabsList aria-label="提出の状態" variant="line">
                  <TabsTrigger value="pending">
                    これからの締切{" "}
                    <span className="count">
                      {all.filter((item) => item.status === "pending").length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="submitted">提出済み</TabsTrigger>
                </TabsList>
                <div className="inline-actions">
                  <span className="sort-label">締切が近い順</span>
                  {user && (
                    <Button
                      variant="ghost"
                      aria-label="最新の締切に更新"
                      disabled={loading}
                      onClick={() => {
                        setLoading(true);
                        void refresh();
                      }}
                    >
                      <RefreshCw aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
              <TabsContent value={filter}>
                {checking || (loading && !all.length) ? (
                  <div aria-label="締切を読み込み中" className="deadline-list">
                    <Skeleton className="h-32 w-full" />
                    <Skeleton className="h-32 w-full" />
                  </div>
                ) : shown.length ? (
                  <div className="deadline-list">
                    {shown.map((item) => {
                      const remaining = remainingLabel(item);
                      const urgent =
                        item.status === "pending" &&
                        (remaining.includes("過ぎ") ||
                          remaining === "今日まで" ||
                          remaining === "明日まで" ||
                          /^あと[23]日$/.test(remaining));
                      return (
                        <article
                          className={`deadline-card ${urgent ? "urgent" : ""} ${item.status === "submitted" ? "submitted" : ""}`}
                          key={item.id}
                        >
                          <div className="date-block">
                            <span className="remaining">{remaining}</span>
                            <strong>
                              {Number(item.due_date.slice(5, 7))}月
                              {Number(item.due_date.slice(8, 10))}日
                            </strong>
                            <span>
                              {item.due_date.slice(0, 4)}年 ·{" "}
                              {item.due_time ?? "時刻未確認"}
                            </span>
                          </div>
                          <div className="deadline-content">
                            <p className="company">
                              {item.company}
                              {!user && (
                                <span className="sample-tag">サンプル</span>
                              )}
                            </p>
                            <h2>{item.task}</h2>
                            <span className="task-tag">
                              {item.submission_url
                                ? "提出先リンクあり"
                                : "提出先未登録"}
                            </span>
                          </div>
                          <Button
                            variant="outline"
                            className="detail-button"
                            onClick={(event) => {
                              detailOpener.current = event.currentTarget;
                              setSelected(item.id);
                            }}
                            aria-label={`${item.company}の提出内容を見る`}
                          >
                            提出内容を見る
                            <ArrowUpRight aria-hidden="true" />
                          </Button>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <Empty className="empty-panel">
                    <EmptyHeader>
                      <EmptyTitle>
                        {filter === "submitted"
                          ? "提出済みの記録はまだありません"
                          : "これからの締切はありません"}
                      </EmptyTitle>
                      <EmptyDescription>
                        {filter === "submitted"
                          ? "提出したら、詳細画面で提出済みにできます。"
                          : "案内メールから、締切と提出先を一緒に残しましょう。"}
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button onClick={() => startAdding()}>
                        {user ? "メールから追加" : "サンプルで試す"}
                      </Button>
                    </EmptyContent>
                  </Empty>
                )}
              </TabsContent>
            </Tabs>
            <aside className="gentle-note">
              <Check aria-hidden="true" />
              <div>
                <strong>メールを探し直さず、提出へ。</strong>
                <p>
                  登録した締切には、提出するものと提出先のリンクを一緒に残せます。
                </p>
                {!user && (
                  <button className="text-link" onClick={() => setView("auth")}>
                    <LogIn aria-hidden="true" className="inline-icon" />
                    既存アカウントでログイン
                  </button>
                )}
              </div>
            </aside>
          </>
        )}
        {view === "add" && (
          <>
            <Button
              variant="ghost"
              className="back-button"
              onClick={() => navigate("list")}
              disabled={busy}
            >
              <ArrowLeft aria-hidden="true" />
              一覧に戻る
            </Button>
            <DeadlineForm
              key={formVersion}
              editing={editing}
              stagedMail={stagedMail}
              cloud={!!user}
              busy={busy}
              onSave={save}
            />
          </>
        )}
        {view === "settings" && (
          <>
            <Button
              variant="ghost"
              className="back-button"
              onClick={() => setView("list")}
            >
              <ArrowLeft aria-hidden="true" />
              一覧に戻る
            </Button>
            <Settings
              key={user?.id ?? "demo"}
              user={user}
              configured={configured}
              onAuth={() => setView("auth")}
              onSignOut={signOut}
              busy={busy}
            />
          </>
        )}
        {view === "auth" && (
          <>
            <Button
              variant="ghost"
              className="back-button"
              onClick={() => setView("list")}
            >
              <ArrowLeft aria-hidden="true" />
              一覧に戻る
            </Button>
            <AuthForm
              configured={configured}
              recovery={recovery}
              onComplete={() => {
                setRecovery(false);
                setView("list");
              }}
            />
          </>
        )}
      </main>
      <Sheet
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
      >
        <SheetContent
          className="detail-sheet"
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            if (detailOpener.current?.isConnected) {
              event.preventDefault();
              detailOpener.current.focus();
            }
          }}
        >
          <SheetHeader>
            <div className="detail-header">
              <SheetTitle>{detail?.company}</SheetTitle>
              <SheetClose asChild>
                <Button variant="ghost" aria-label="詳細を閉じる">
                  <X aria-hidden="true" />
                </Button>
              </SheetClose>
            </div>
            <SheetDescription>
              いつまでに、何を、どこから提出するかを確認。
            </SheetDescription>
          </SheetHeader>
          {detail && (
            <div className="detail-body">
              <span className="small-badge">{remainingLabel(detail)}</span>
              <dl className="detail-dl">
                <div>
                  <dt>提出するもの</dt>
                  <dd>{detail.task}</dd>
                </div>
                <div>
                  <dt>締切（日本時間）</dt>
                  <dd>
                    {detail.due_date.replaceAll("-", "/")}{" "}
                    {detail.due_time ?? "時刻未確認"}
                  </dd>
                </div>
                <div>
                  <dt>提出先</dt>
                  <dd>
                    {detail.submission_url ? (
                      <>
                        <a
                          href={detail.submission_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="company-link"
                        >
                          {new URL(detail.submission_url).hostname}
                          <ArrowUpRight
                            className="inline-icon"
                            aria-hidden="true"
                          />
                        </a>
                        <p className="helper">
                          企業のページで内容を確認して提出してください。
                        </p>
                      </>
                    ) : (
                      "提出先のリンクは未登録です。編集から追加できます。"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>通知の予定</dt>
                  <dd className="notice-line">
                    {user
                      ? detail.status === "submitted"
                        ? "提出済みのため通知しません。"
                        : reminderTimes(detail).length
                          ? reminderTimes(detail)
                              .map(
                                (slot) =>
                                  `${slot.days}日前: ${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(slot.at))}`,
                              )
                              .join(" / ") + "（有効な配信方法に送ります）"
                          : "通知時刻を過ぎているため、今後の予定はありません。"
                      : "サンプルでは通知を送りません。"}
                  </dd>
                </div>
              </dl>
              <div className="form-actions">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setEditing(detail);
                    setStagedMail("");
                    setFormVersion((value) => value + 1);
                    closeDetail();
                    setView("add");
                  }}
                >
                  内容を編集
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void toggleSubmitted(detail)}
                >
                  <Check aria-hidden="true" />
                  {busy
                    ? "更新中…"
                    : detail.status === "pending"
                      ? "提出済みにする"
                      : "未提出に戻す"}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <footer className="app-footer">
        締切ノート <span>確認してから保存。あなたのペースで、一歩ずつ。</span>
      </footer>
      <Toaster position="bottom-center" richColors />
    </>
  );
}

function DeadlineForm({
  editing,
  stagedMail,
  cloud,
  busy,
  onSave,
}: {
  editing: Deadline | null;
  stagedMail: string;
  cloud: boolean;
  busy: boolean;
  onSave: (input: DeadlineInput, id: string) => Promise<boolean>;
}) {
  const initialCandidates = stagedMail ? extractMail(stagedMail) : null;
  const [mail, setMail] = useState(stagedMail);
  const [candidates, setCandidates] = useState<MailCandidates | null>(
    initialCandidates,
  );
  const [input, setInput] = useState<DeadlineInput>(
    editing
      ? { ...editing }
      : initialCandidates
        ? candidateInput(initialCandidates)
        : { ...blank },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newId] = useState(() => crypto.randomUUID());
  const [manual, setManual] = useState(!!editing || !!stagedMail);
  const candidateResultsRef = useRef<HTMLDivElement>(null);
  const hasCandidates = !!(
    candidates &&
    (candidates.company ||
      candidates.tasks.length ||
      candidates.dates.length ||
      candidates.links.length)
  );

  function candidateInput(data: MailCandidates): DeadlineInput {
    const date = data.dates.length === 1 ? data.dates[0] : null;
    return {
      ...blank,
      company: data.company,
      task: data.tasks.length === 1 ? data.tasks[0] : "",
      due_date: date?.date ?? "",
      due_time: date?.date ? date.time : null,
      submission_url: data.links.length === 1 ? data.links[0] : null,
    };
  }
  function parse(value = mail) {
    try {
      const data = extractMail(value);
      setCandidates(data);
      setInput(candidateInput(data));
      setManual(true);
      setErrors({});
      requestAnimationFrame(() => {
        candidateResultsRef.current?.focus();
      });
    } catch (failure) {
      setErrors({
        mail:
          failure instanceof Error
            ? failure.message
            : "本文を確認してください。",
      });
    }
  }
  function change(key: keyof DeadlineInput, value: string) {
    setInput((current) => ({
      ...current,
      [key]:
        value || (key === "due_time" || key === "submission_url" ? null : ""),
    }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const validation = validateDeadline(input);
    setErrors(validation);
    if (Object.keys(validation).length) {
      document.getElementById(Object.keys(validation)[0])?.focus();
      return;
    }
    if (await onSave(input, newId)) {
      setMail("");
      setCandidates(null);
    }
  }
  const field = (
    key: "company" | "task" | "due_date" | "due_time" | "submission_url",
    label: string,
    type = "text",
    optional = false,
  ) => (
    <div>
      <label htmlFor={key}>
        {label}
        {optional && <span className="optional-label">任意</span>}
      </label>
      <input
        id={key}
        type={type}
        value={input[key] ?? ""}
        onChange={(event) => change(key, event.target.value)}
        maxLength={
          key === "company"
            ? 120
            : key === "task"
              ? 240
              : key === "submission_url"
                ? 2048
                : undefined
        }
        aria-invalid={!!errors[key]}
        aria-describedby={
          errors[key]
            ? `${key}-error`
            : key === "due_time"
              ? "time-help"
              : undefined
        }
      />
      {errors[key] && (
        <p id={`${key}-error`} className="error-text">
          {errors[key]}
        </p>
      )}
    </div>
  );
  return (
    <section className="form-panel">
      <h1 className="form-title">
        {editing
          ? "締切の内容を編集"
          : cloud
            ? "メールから締切を追加"
            : "架空メールから締切の追加を試す"}
      </h1>
      {!editing && (
        <>
          <p className="helper">
            メール本文を貼り付けて候補を確認します。読み取れない項目は手で入力できます。
            {!cloud && " サンプルの変更は保存・同期されません。"}
          </p>
          <label htmlFor="mail">案内メールの本文</label>
          <textarea
            id="mail"
            rows={6}
            maxLength={20000}
            value={mail}
            onChange={(event) => setMail(event.target.value)}
            placeholder={
              cloud
                ? "企業から届いた案内メールを、ここに貼り付けてください。"
                : "「架空メールで試す」を押してください。実際の案内メールは貼り付けないでください。"
            }
            aria-invalid={!!errors.mail}
            aria-describedby="mail-help"
          />
          <p className="helper" id="mail-help">
            {cloud
              ? "本文はこの端末で読み取り、保管・外部送信しません。確認した項目だけを保存します。"
              : "本文はこの端末だけで読み取り、保存・送信しません。サンプルの変更は再読み込みで消えます。"}
          </p>
          {errors.mail && (
            <p className="error-text" role="alert">
              {errors.mail}
            </p>
          )}
          <div className="inline-actions">
            <Button type="button" onClick={() => parse()}>
              <ClipboardPaste aria-hidden="true" />
              候補を読み取る
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const value = sampleMail();
                setMail(value);
                parse(value);
              }}
            >
              架空メールで試す
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setManual(true)}
            >
              手で入力する
            </Button>
          </div>
        </>
      )}
      {candidates && (
        <div
          className="candidate-note"
          ref={candidateResultsRef}
          tabIndex={-1}
          aria-label="メールの読み取り結果"
        >
          <strong>
            {hasCandidates
              ? "読み取り結果を確認してください"
              : "候補を読み取れませんでした"}
          </strong>
          {!hasCandidates && (
            <>
              <p>
                メールの書き方によっては読み取れません。下の欄から登録できます。
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => document.getElementById("company")?.focus()}
              >
                入力欄へ進む
              </Button>
            </>
          )}
          {candidates.notes
            .filter((note) => hasCandidates || /相対|24:00/.test(note))
            .map((note) => (
              <p key={note}>{note}</p>
            ))}
          {candidates.dates.length > 1 && (
            <>
              <p>どの締切を登録しますか？</p>
              <div className="candidate-list">
                {candidates.dates.map((date, i) => (
                  <Button
                    key={i}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setInput((current) => ({
                        ...current,
                        due_date: date.date ?? "",
                        due_time: date.time,
                      }));
                    }}
                  >
                    {date.label}
                  </Button>
                ))}
              </div>
            </>
          )}
          {candidates.links.length > 1 && (
            <>
              <p>提出先の候補</p>
              <div className="candidate-list">
                {candidates.links.map((url, i) => (
                  <Button
                    type="button"
                    variant="outline"
                    key={url}
                    onClick={() => change("submission_url", url)}
                  >
                    {i + 1}. {new URL(url).hostname}
                  </Button>
                ))}
              </div>
            </>
          )}
          {candidates.tasks.length > 1 && (
            <>
              <p>提出内容の候補</p>
              <div className="candidate-list">
                {candidates.tasks.map((task) => (
                  <Button
                    type="button"
                    variant="outline"
                    key={task}
                    onClick={() => change("task", task)}
                  >
                    {task}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {manual && (
        <form noValidate onSubmit={submit}>
          <div className="field-row">
            {field("company", "企業名")}
            {field("task", "提出するもの")}
          </div>
          <div className="field-row">
            {field("due_date", "締切日（年も確認）", "date")}
            {field("due_time", "締切時刻（日本時間）", "time", true)}
          </div>
          <p className="helper" id="time-help">
            時刻が分からない場合は空欄にします。「23:59」などを自動では補いません。
          </p>
          {field("submission_url", "提出先のリンク", "url", true)}
          <p className="helper">
            提出するものが複数ある場合は、締切ごとに分けて登録できます。
          </p>
          <div className="privacy-note">
            通知は3日前と前日の午前9時（日本時間）。過ぎた通知時刻の分は送らず、次の予定から知らせます。
            {cloud && (
              <p>
                通知の実際の到着は確認中です。大切な締切は元の案内でも確認してください。
              </p>
            )}
            {!cloud && (
              <p>
                サンプル体験の変更は再読み込みで消えます。同期・通知は使えません。
              </p>
            )}
          </div>
          <div className="form-actions">
            <Button type="submit" disabled={busy}>
              {busy
                ? "保存中…"
                : cloud
                  ? "確認して保存"
                  : "確認してサンプルに追加"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function AuthForm({
  configured,
  recovery,
  onComplete,
}: {
  configured: boolean;
  recovery: boolean;
  onComplete: () => void;
}) {
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    const client = getSupabase();
    if (!client) {
      setError("オンライン機能は準備中です。サンプル体験は使えます。");
      return;
    }
    setBusy(true);
    try {
      if (recovery) {
        const { error: failure } = await client.auth.updateUser({ password });
        if (failure) throw failure;
        setPassword("");
        onComplete();
        toast.success("パスワードを更新しました。");
      } else if (mode === "signin") {
        const { error: failure } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (failure) throw failure;
        setPassword("");
        onComplete();
      } else {
        const { error: failure } = await client.auth.resetPasswordForEmail(
          email,
          { redirectTo: window.location.origin },
        );
        if (failure) throw failure;
        setMessage(
          "登録されている場合、再設定の案内が届きます。届かないときは迷惑メールも確認してください。",
        );
      }
    } catch (failure) {
      setError(appError(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form-panel auth-panel">
      <h1 className="form-title">
        {recovery
          ? "新しいパスワードを設定"
          : mode === "reset"
            ? "パスワードを再設定"
            : "ログイン"}
      </h1>
      <p className="helper">
        {recovery
          ? "新しいパスワードを入力してください。"
          : mode === "signin"
            ? "登録時に決めた締切ノートのパスワードを入力してください。スマホとPCで同じ締切情報を使えます。"
            : "登録済みのメールアドレスに再設定の案内を送ります。"}
      </p>
      {!recovery && (
        <div className="candidate-note">
          この公開デモでは新規登録を受け付けていません。架空データの操作はログインなしで試せます。
        </div>
      )}
      {!configured && (
        <div className="candidate-note">
          オンライン機能は準備中です。現在はサンプルで操作を試せます。
        </div>
      )}
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="success-box">
          {message}
        </div>
      )}
      <form onSubmit={submit}>
        {!recovery && (
          <>
            <label htmlFor="email">メールアドレス</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </>
        )}
        {(recovery || mode !== "reset") && (
          <>
            <label htmlFor="password">
              パスワード{recovery ? "（8文字以上）" : ""}
            </label>
            <input
              id="password"
              type="password"
              autoComplete={recovery ? "new-password" : "current-password"}
              required
              minLength={recovery ? 8 : undefined}
              maxLength={72}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </>
        )}
        <div className="form-actions">
          <Button disabled={busy || !configured} type="submit">
            {busy
              ? "処理中…"
              : recovery
                ? "パスワードを更新"
                : mode === "reset"
                  ? "再設定メールを送る"
                  : "ログイン"}
          </Button>
        </div>
      </form>
      {!recovery && (
        <div className="auth-links">
          {mode === "reset" && (
            <button
              className="text-link"
              onClick={() => {
                setMode("signin");
                setError("");
                setMessage("");
              }}
            >
              ログインへ戻る
            </button>
          )}
          {mode === "signin" && (
            <button
              className="text-link"
              onClick={() => {
                setMode("reset");
                setError("");
                setMessage("");
              }}
            >
              パスワードを忘れた場合
            </button>
          )}
        </div>
      )}
      <p className="privacy-note">
        メール本文は保管しません。確認した締切情報と、ログイン・通知に必要な情報を保存します。
      </p>
    </section>
  );
}

function Settings({
  user,
  configured,
  onAuth,
  onSignOut,
  busy,
}: {
  user: User | null;
  configured: boolean;
  onAuth: () => void;
  onSignOut: () => Promise<void>;
  busy: boolean;
}) {
  const [settings, setSettings] = useState({
    email_enabled: false,
    push_enabled: false,
  });
  const [loading, setLoading] = useState(!!user);
  const [saving, setSaving] = useState(false);
  const [localPush, setLocalPush] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    const client = getSupabase();
    if (!user || !client) return;
    void (async () => {
      try {
        const { data, error: failure } = await client
          .from("notification_settings")
          .select("email_enabled,push_enabled")
          .eq("owner_id", user.id)
          .maybeSingle();
        if (failure) throw failure;
        const subscription = await currentSubscription();
        let device = false;
        if (subscription && Notification.permission === "granted") {
          const { data: row, error: deviceError } = await client
            .from("push_subscriptions")
            .select("id")
            .eq("endpoint", subscription.endpoint)
            .maybeSingle();
          if (deviceError) throw deviceError;
          device = !!row;
        }
        if (disposed) return;
        if (data) setSettings(data);
        setLocalPush(device);
      } catch (failure) {
        if (!disposed) setError(appError(failure));
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [user]);
  async function update(next: {
    email_enabled: boolean;
    push_enabled: boolean;
  }) {
    if (!user) return;
    setSaving(true);
    setError("");
    const { error: failure } = await getSupabase()!
      .from("notification_settings")
      .upsert({ ...next, owner_id: user.id }, { onConflict: "owner_id" });
    setSaving(false);
    if (failure) setError(appError(failure));
    else setSettings(next);
  }
  async function enablePush() {
    if (!user) return;
    setSaving(true);
    setError("");
    try {
      const subscription = await subscribePush();
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth)
        throw new Error("通知の登録情報を取得できませんでした。");
      const { error: failure } = await getSupabase()!
        .from("push_subscriptions")
        .upsert(
          {
            owner_id: user.id,
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth_key: json.keys.auth,
          },
          { onConflict: "owner_id,endpoint" },
        );
      if (failure) throw failure;
      const { error: settingError } = await getSupabase()!
        .from("notification_settings")
        .upsert(
          { ...settings, push_enabled: true, owner_id: user.id },
          { onConflict: "owner_id" },
        );
      if (settingError) throw settingError;
      setSettings((current) => ({ ...current, push_enabled: true }));
      setLocalPush(true);
      toast.success("この端末のプッシュを有効にしました。");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : appError(failure));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="form-panel settings-panel">
      <h1 className="form-title">通知とアカウント</h1>
      <p className="helper">
        締切の3日前と前日、午前9時（日本時間）に知らせる設計です。実際の到着は確認中です。
      </p>
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      {!user ? (
        <>
          <div className="setting-row">
            <div>
              <strong>メール通知</strong>
              <p>ログイン後に受け取りを設定できます。</p>
            </div>
            <span className="small-badge">未設定</span>
          </div>
          <div className="setting-row">
            <div>
              <strong>スマホのプッシュ通知</strong>
              <p>Androidの対応ブラウザで、通知を許可します。</p>
            </div>
            <span className="small-badge">未設定</span>
          </div>
          <p className="helper">
            {configured
              ? "ログインして通知を設定しましょう。"
              : "オンラインの保存・配信設定は準備中です。現在はサンプル体験が使えます。"}
          </p>
          <Button onClick={onAuth}>既存アカウントでログイン</Button>
        </>
      ) : loading ? (
        <div className="loading-panel" role="status">
          通知の設定を確認しています…
        </div>
      ) : (
        <>
          <div className="setting-row">
            <div>
              <strong>{user.email}</strong>
              <p>同じメールアドレスでスマホとPCへログインします。</p>
            </div>
            <Button
              variant="outline"
              disabled={busy || saving}
              onClick={() => void onSignOut()}
            >
              ログアウト
            </Button>
          </div>
          <div className="setting-row">
            <div>
              <label htmlFor="email-notifications" className="switch-label">
                メール通知
              </label>
              <p>
                {settings.email_enabled ? "受け取り有効" : "受け取り停止中"} ·
                登録したメールアドレスへ送ります。
              </p>
            </div>
            <Switch
              id="email-notifications"
              checked={settings.email_enabled}
              disabled={saving}
              onCheckedChange={(checked) =>
                void update({ ...settings, email_enabled: checked })
              }
            />
          </div>
          <div className="setting-row">
            <div>
              <label htmlFor="push-notifications" className="switch-label">
                プッシュ通知
              </label>
              <p>
                {settings.push_enabled
                  ? localPush
                    ? "この端末で有効"
                    : "別の端末で有効、またはこの端末は未設定"
                  : "受け取り停止中"}
              </p>
            </div>
            <Switch
              id="push-notifications"
              checked={settings.push_enabled}
              disabled={saving}
              onCheckedChange={(checked) =>
                checked
                  ? void enablePush()
                  : void update({ ...settings, push_enabled: false })
              }
            />
          </div>
          {!localPush && (
            <Button
              variant="outline"
              className="push-button"
              onClick={() => void enablePush()}
              disabled={saving}
            >
              {saving ? "設定中…" : "この端末でプッシュを設定"}
            </Button>
          )}
          <p className="helper">
            {pushSupported()
              ? "ブラウザの通知許可が必要です。拒否した場合はサイト設定から変更できます。"
              : "このブラウザでプッシュを設定できない場合は、AndroidのChromeなどで開いてください。"}{" "}
            ロック画面には応募先を表示しません。
          </p>
          <p className="privacy-note">
            提出済みの締切には通知しません。締切を変更すると、今後の通知予定も変更します。すでに届いた通知は取り消せません。
          </p>
        </>
      )}
    </section>
  );
}
