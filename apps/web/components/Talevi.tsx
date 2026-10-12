"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Sparkles,
  Compass,
  MessageCircle,
  Bookmark,
  Plus,
  Search,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  Leaf,
  BookOpen,
  Heart,
  Settings,
  Send,
  Feather,
  X,
  Check,
  Trash2,
  Pencil,
  Wallet,
  UserRound,
  Download,
  LogOut,
  Flag,
  RefreshCw,
  Wind,
  MapPin,
  LockKeyhole,
} from "lucide-react";
import {
  ko,
  type Character,
  type Conversation,
  type ConversationSummary,
  type User,
  type Memory,
  ApiError,
} from "@yeoun/contracts";
import { api, followTurn } from "@/lib/api";
import Modal from "./Modal";
import Image from "next/image";
import BrandIcon from "./BrandIcon";
type Tab = "discover" | "chats" | "saved";
type Order = {
  id: string;
  amount: number;
  credits: number;
  customer_key: string;
  demo: boolean;
  client_key: string;
};
type WalletData = {
  credits: number;
  entries: { id: string; delta: number; reason: string; created: number }[];
  demo: boolean;
  available: boolean;
  client_key: string;
};
const genres = ["전체", "힐링", "로맨스", "일상", "판타지", "미스터리"];
function Portrait({
  character,
  className = "",
  eager = false,
}: {
  character: Character;
  className?: string;
  eager?: boolean;
}) {
  return character.image ? (
    <Image
      width={1024}
      height={1536}
      sizes="(max-width: 700px) 50vw, (max-width: 1100px) 25vw, 320px"
      className={className}
      src={character.image}
      alt={`${character.name}, ${character.role}`}
      loading={eager ? "eager" : "lazy"}
    />
  ) : (
    <div
      className={`portrait-fallback ${className}`}
      style={{ background: character.color }}
    >
      <Feather size={40} />
      <span>{character.name}</span>
    </div>
  );
}
function RichText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
        .map((part, i) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={i}>{part.slice(2, -2)}</strong>
          ) : part.startsWith("*") && part.endsWith("*") ? (
            <em key={i}>{part.slice(1, -1)}</em>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
    </>
  );
}
export default function Talevi() {
  const [characters, setCharacters] = useState<Character[]>([]),
    [user, setUser] = useState<User | null>(null),
    [convs, setConvs] = useState<ConversationSummary[]>([]),
    [tab, setTab] = useState<Tab>("discover");
  const [gender, setGender] = useState("전체");
  const [artStyle, setArtStyle] = useState("전체");
  const [featureIndex, setFeatureIndex] = useState(0);
  const [genre, setGenre] = useState("전체"),
    [query, setQuery] = useState(""),
    [saved, setSaved] = useState<string[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [demo, setDemo] = useState(false),
    [detail, setDetail] = useState<Character | null>(null),
    [chat, setChat] = useState<Conversation | null>(null),
    [draft, setDraft] = useState(""),
    [sending, setSending] = useState(false),
    [stream, setStream] = useState("");
  const [mode, setMode] = useState<"quick" | "story">("quick"),
    [panel, setPanel] = useState<"memory" | "relation" | "settings">("memory"),
    [showPanel, setShowPanel] = useState(false);
  const [modal, setModal] = useState<"wallet" | "account" | "create" | null>(
      null,
    ),
    [wallet, setWallet] = useState<WalletData | null>(null),
    [busy, setBusy] = useState(false),
    [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [memoryEdit, setMemoryEdit] = useState<Memory | null>(null),
    [memoryValue, setMemoryValue] = useState(""),
    [memoryKey, setMemoryKey] = useState(""),
    [showMemoryForm, setShowMemoryForm] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null),
    [pendingRetry, setPendingRetry] = useState<{
      client_id: string;
      content: string;
      mode: "quick" | "story";
      story_event: string | null;
    } | null>(null);
  const controller = useRef<AbortController | null>(null),
    bottom = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    sendLock = useRef(false);
  const current = characters.find((c) => c.id === chat?.character_id);
  const notify = (s: string) => {
    setNotice(s);
  };
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  const loadCatalog = useCallback(async () => {
    try {
      setCharacters(await api<Character[]>("/v1/characters"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  const loadMe = useCallback(async () => {
    try {
      const me = await api<User>("/v1/me");
      setUser(me);
      setConvs(await api<ConversationSummary[]>("/v1/conversations"));
      return me;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    void loadCatalog();
    void loadMe();
    api<{ mode: string }>("/health")
      .then((h) => setDemo(h.mode === "demo"))
      .catch(() => {});
    try {
      setSaved(JSON.parse(localStorage.getItem("yeoun-bookmarks") || "[]"));
    } catch {}
    return () => controller.current?.abort();
  }, [loadCatalog, loadMe]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat?.messages.length, stream]);
  const ensureUser = async () => {
    if (user) return user;
    const r = await api<{ user: User }>("/v1/auth/guest", {
      method: "POST",
      body: JSON.stringify({}),
    });
    setUser(r.user);
    return r.user;
  };
  const toggleSave = (id: string) => {
    setSaved((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      localStorage.setItem("yeoun-bookmarks", JSON.stringify(next));
      return next;
    });
  };
  const refreshChat = async (id: string) => {
    const c = await api<Conversation>(`/v1/conversations/${id}`);
    setChat(c);
    await loadMe();
    return c;
  };
  const listen = async (cid: string, tid: string) => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setSending(true);
    setStream("");
    try {
      await followTurn(
        tid,
        (item) => {
          if (item.event === "delta")
            setStream((s) => s + String(item.data.text));
          if (item.event === "failed") {
            setError(String(item.data.message));
            setStream("");
          }
        },
        ctrl.signal,
      );
      if (!ctrl.signal.aborted) await refreshChat(cid);
    } catch (e) {
      if (!ctrl.signal.aborted) setError((e as Error).message);
    } finally {
      if (!ctrl.signal.aborted) {
        setSending(false);
        setStream("");
        sendLock.current = false;
      }
    }
  };
  const openChat = async (c: Character, id?: string) => {
    setError("");
    setBusy(true);
    try {
      await ensureUser();
      const known = id || convs.find((x) => x.character_id === c.id)?.id;
      const cid =
        known ||
        (
          await api<{ id: string }>("/v1/conversations", {
            method: "POST",
            body: JSON.stringify({ character_id: c.id }),
          })
        ).id;
      const data = await refreshChat(cid);
      setDetail(null);
      setDraft(localStorage.getItem("yeoun-draft:" + cid) || "");
      setPendingRetry(null);
      setShowPanel(false);
      if (data.active_turn) void listen(cid, data.active_turn);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const closeChat = () => {
    controller.current?.abort();
    setChat(null);
    setSending(false);
    sendLock.current = false;
    setError("");
    void loadMe();
  };
  const send = async (
    text = draft,
    storyEvent: string | null = null,
    retry = false,
  ) => {
    if (!chat || !text.trim() || sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    setError("");
    const body =
      retry && pendingRetry
        ? pendingRetry
        : {
            client_id: crypto.randomUUID(),
            content: text.trim(),
            mode,
            story_event: storyEvent,
          };
    setPendingRetry(body);
    try {
      const turn = await api<{ id: string }>(
        `/v1/conversations/${chat.id}/turns`,
        { method: "POST", body: JSON.stringify(body) },
      );
      setDraft("");
      localStorage.removeItem("yeoun-draft:" + chat.id);
      setPendingRetry(null);
      await refreshChat(chat.id);
      await listen(chat.id, turn.id);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 402) void openWallet();
      setSending(false);
      sendLock.current = false;
    }
  };
  const updateDraft = (s: string) => {
    setDraft(s);
    if (chat) localStorage.setItem("yeoun-draft:" + chat.id, s);
  };
  const openWallet = async () => {
    setModal("wallet");
    setBusy(true);
    try {
      await ensureUser();
      setWallet(await api<WalletData>("/v1/wallet"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const purchase = async (sku: string) => {
    setBusy(true);
    setError("");
    try {
      const o = await api<Order>("/v1/payments/orders", {
        method: "POST",
        body: JSON.stringify({ sku }),
      });
      if (o.demo) {
        await api("/v1/payments/confirm", {
          method: "POST",
          body: JSON.stringify({
            order_id: o.id,
            payment_key: "demo:" + o.id,
            amount: o.amount,
          }),
        });
        setWallet(await api<WalletData>("/v1/wallet"));
        await loadMe();
        notify("테스트 빛을 충전했어요. 실제 결제는 발생하지 않았어요.");
      } else {
        const { loadTossPayments } =
          await import("@tosspayments/tosspayments-sdk");
        const toss = await loadTossPayments(o.client_key);
        if (chat) sessionStorage.setItem("yeoun-return-chat", chat.id);
        await toss.payment({ customerKey: o.customer_key }).requestPayment({
          method: "CARD",
          amount: { currency: "KRW", value: o.amount },
          orderId: o.id,
          orderName: `테일비 빛 ${o.credits}개`,
          successUrl: location.origin + "/payment/success",
          failUrl: location.origin + "/payment/fail",
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!characters.length) return;
    const cid = sessionStorage.getItem("yeoun-return-chat");
    if (cid) {
      sessionStorage.removeItem("yeoun-return-chat");
      api<Conversation>(`/v1/conversations/${cid}`)
        .then((c) => {
          setChat(c);
          setDraft(localStorage.getItem("yeoun-draft:" + cid) || "");
          if (c.active_turn) void listen(cid, c.active_turn);
        })
        .catch(() => {});
    }
  }, [characters.length]);
  const saveMemory = async () => {
    if (!chat || !memoryValue.trim()) return;
    setBusy(true);
    try {
      if (memoryEdit)
        await api(`/v1/memories/${memoryEdit.id}`, {
          method: "PATCH",
          body: JSON.stringify({ value: memoryValue }),
        });
      else
        await api(`/v1/conversations/${chat.id}/memories`, {
          method: "POST",
          body: JSON.stringify({ key: memoryKey, value: memoryValue }),
        });
      await refreshChat(chat.id);
      setShowMemoryForm(false);
      setMemoryEdit(null);
      setMemoryValue("");
      setMemoryKey("");
      notify("기억 노트에 저장했어요.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const deleteMemory = async (m: Memory) => {
    try {
      await api(`/v1/memories/${m.id}`, { method: "DELETE" });
      if (chat) await refreshChat(chat.id);
      notify("기억을 지웠어요. 이후 답변에 사용하지 않아요.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const settingsChange = async (next: Conversation["settings"]) => {
    if (!chat) return;
    try {
      await api(`/v1/conversations/${chat.id}/settings`, {
        method: "PATCH",
        body: JSON.stringify(next),
      });
      setChat({ ...chat, settings: next });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const auth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await api(`/v1/auth/${authMode}`, {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form)),
      });
      await loadMe();
      await loadCatalog();
      setChat(null);
      setModal(null);
      notify(
        authMode === "register"
          ? "대화와 기억이 계정에 저장되었어요."
          : "다시 만나서 반가워요.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const exportData = async () => {
    try {
      const data = await api("/v1/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "yeoun-conversations.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const createCharacter = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await ensureUser();
      const c = await api<Character>("/v1/characters", {
        method: "POST",
        body: JSON.stringify({ ...form, age: Number(form.age) }),
      });
      await loadCatalog();
      setModal(null);
      setDetail(c);
      notify("나만 볼 수 있는 캐릭터를 만들었어요.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const filtered = characters.filter(
    (c) =>
      (genre === "전체" ||
        c.genre === genre ||
        (genre === "로맨스" && c.tags.some((t) => t.includes("로맨스")))) &&
      `${c.name} ${c.role} ${c.tags.join(" ")} ${c.description}`.includes(
        query,
      ) &&
      (gender === "전체" || c.gender === gender) &&
      (artStyle === "전체" || c.art_style === artStyle) &&
      (tab !== "saved" || saved.includes(c.id)),
  );
  const spotlights = ["doyun", "eunho", "igyeol", "arin"].flatMap((id) =>
    characters.filter((c) => c.id === id),
  );
  const featured = spotlights[featureIndex % Math.max(spotlights.length, 1)];
  const fantasyPick = characters.find((c) => c.id === "kairen");
  return (
    <div className={`app-shell ${chat ? "in-chat" : ""}`}>
      <aside className="sidebar">
        <a className="wordmark" href="/" aria-label="테일비 홈">
          <BrandIcon />
          <span>
            talevi<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="sidebar-caption">상상보다 가까운 이야기</div>
        <nav aria-label="주 메뉴">
          {(
            [
              { id: "discover", label: ko.discover, icon: Compass },
              { id: "chats", label: ko.conversations, icon: MessageCircle },
              { id: "saved", label: ko.bookmarks, icon: Bookmark },
            ] as const
          ).map((n) => (
            <button
              key={n.id}
              className={tab === n.id && !chat ? "nav-item active" : "nav-item"}
              onClick={() => {
                closeChat();
                setTab(n.id);
              }}
            >
              <n.icon size={21} />
              {n.label}
              {n.id === "chats" && convs.length > 0 && (
                <span className="nav-count">{convs.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-divider" />
        <button className="nav-item" onClick={() => setModal("create")}>
          <Plus size={21} />
          {ko.create}
        </button>
        <button
          className="nav-item mobile-account"
          onClick={() => {
            setError("");
            setModal("account");
          }}
        >
          <UserRound size={21} />내 계정
        </button>
        <div className="sidebar-bottom">
          <div className="small-note">
            <Sparkles size={20} />
            <p>
              취향이 되는 첫 대화.
              <br />
              테일비 오리지널
            </p>
          </div>
          <button className="wallet-button" onClick={openWallet}>
            <Sparkles size={17} />
            <span>나의 빛</span>
            <strong>{user?.credits ?? 30}</strong>
            <Plus size={16} />
          </button>
          <button
            className="account-button"
            onClick={() => setModal("account")}
          >
            <span className="avatar">
              <UserRound size={18} />
            </span>
            <span>
              {user?.email ? user.nickname : "여행자"}
              <small>
                {user?.email ? "계정 관리" : "대화 이어서 저장하기"}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
          <div className="sidebar-footer">
            한국어 <span>© 2026 TALEVI</span>
          </div>
        </div>
      </aside>
      <main className="main">
        {!chat && (
          <>
            <header className="topbar">
              <a href="/" className="mobile-logo" aria-label="테일비 홈">
                <BrandIcon size={30} />
                <span className="mobile-wordmark">
                  talevi<span>.</span>
                </span>
              </a>
              <div className="breadcrumb">
                {tab === "discover"
                  ? "탐색"
                  : tab === "chats"
                    ? "나의 대화"
                    : "책갈피"}
              </div>
              <label className="search-box">
                <Search size={19} />
                <input
                  aria-label="캐릭터 검색"
                  placeholder={ko.search}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setTab("discover");
                  }}
                />
                {query && (
                  <button onClick={() => setQuery("")} aria-label="검색 지우기">
                    <X size={16} />
                  </button>
                )}
              </label>
              <button className="top-wallet" onClick={openWallet}>
                <Sparkles size={17} />
                {user?.credits ?? 30}
              </button>
            </header>
            {demo && (
              <div className="demo-banner">
                로컬 체험 모드 — 예시 답변과 테스트 결제를 제공합니다.
              </div>
            )}
            <div className="discovery-page">
              {tab === "discover" &&
                !query &&
                genre === "전체" &&
                gender === "전체" &&
                artStyle === "전체" &&
                featured && (
                  <section
                    className="spotlight-section"
                    aria-label="추천 이야기"
                  >
                    <div className="section-intro">
                      <div>
                        <span className="eyebrow">TALEVI ORIGINALS</span>
                        <h1>취향이 되는 첫 대화</h1>
                      </div>
                      <span className="new-label">새로운 10개의 이야기</span>
                    </div>
                    <div className="spotlight-grid">
                      <article className={`spotlight spotlight-${featured.id}`}>
                        <Portrait character={featured} eager />
                        <div className="spotlight-shade" />
                        <div className="spotlight-copy">
                          <span className="spotlight-label">
                            오늘의 만남 <span>{featured.art_style}</span>
                          </span>
                          <h2>{featured.headline}</h2>
                          <p>
                            {featured.name}{" "}
                            <span>
                              — {featured.tags.slice(0, 2).join(", ")}
                            </span>
                          </p>
                          <button
                            className="spotlight-cta"
                            onClick={() => setDetail(featured)}
                          >
                            이야기 만나보기 <ArrowRight size={16} />
                          </button>
                        </div>
                        <div
                          className="spotlight-controls"
                          aria-label="추천 이야기 넘기기"
                        >
                          <button
                            aria-label="이전 추천"
                            onClick={() =>
                              setFeatureIndex(
                                (featureIndex + spotlights.length - 1) %
                                  spotlights.length,
                              )
                            }
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span>
                            {featureIndex + 1} <i>/ {spotlights.length}</i>
                          </span>
                          <button
                            aria-label="다음 추천"
                            onClick={() =>
                              setFeatureIndex(
                                (featureIndex + 1) % spotlights.length,
                              )
                            }
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </article>
                      {fantasyPick && (
                        <button
                          className="side-spotlight"
                          onClick={() => setDetail(fantasyPick)}
                          aria-label="카이렌 이야기 살펴보기"
                        >
                          <Portrait character={fantasyPick} eager />
                          <span className="side-shade" />
                          <span className="side-badge">판타지에 빠질 시간</span>
                          <span className="side-copy">
                            <small>위험한 초대, 선택은 당신에게</small>
                            <strong>
                              자정의 무도회에서
                              <br />
                              당신을 기다리고 있어.
                            </strong>
                            <span>
                              카이렌 <ArrowUpRight size={18} />
                            </span>
                          </span>
                        </button>
                      )}
                    </div>
                  </section>
                )}
              <section className="browse-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      {tab === "saved"
                        ? "내가 고른 캐릭터"
                        : tab === "chats"
                          ? "이어서 대화하기"
                          : query
                            ? `‘${query}’ 검색 결과`
                            : "지금 만나고 싶은 캐릭터"}
                    </h2>
                    <p>
                      {tab === "chats"
                        ? "우리의 이야기는 여기서 이어져요."
                        : "마음에 드는 얼굴, 궁금해지는 이야기."}
                    </p>
                  </div>
                  {tab !== "chats" && (
                    <span className="result-count" aria-live="polite">
                      {filtered.length}명
                    </span>
                  )}
                </div>
                {tab !== "chats" && (
                  <>
                    <div className="taste-toolbar">
                      <div
                        className="gender-tabs"
                        role="group"
                        aria-label="캐릭터 성별"
                      >
                        {["전체", "여성", "남성"].map((g) => (
                          <button
                            key={g}
                            aria-pressed={gender === g}
                            className={gender === g ? "selected" : ""}
                            onClick={() => setGender(g)}
                          >
                            {g === "전체" ? "모든 캐릭터" : `${g} 캐릭터`}
                          </button>
                        ))}
                      </div>
                      <div
                        className="style-switch"
                        role="group"
                        aria-label="그림체 선택"
                      >
                        {["전체", "애니메이션", "반실사"].map((style) => (
                          <button
                            key={style}
                            aria-pressed={artStyle === style}
                            className={artStyle === style ? "selected" : ""}
                            onClick={() => setArtStyle(style)}
                          >
                            {style === "전체" ? "모든 그림체" : style}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div
                      className="filters"
                      role="group"
                      aria-label="장르 선택"
                    >
                      {genres.map((g) => (
                        <button
                          aria-pressed={genre === g}
                          className={genre === g ? "selected" : ""}
                          onClick={() => setGenre(g)}
                          key={g}
                        >
                          {g === "전체" && <Compass size={15} />} {g}
                        </button>
                      ))}
                    </div>
                    <div id="character-grid" className="character-grid">
                      {filtered.map((c) => (
                        <article className="character-card" key={c.id}>
                          <div className="card-art">
                            <button
                              className="card-open"
                              onClick={() => setDetail(c)}
                              aria-label={`${c.name} 이야기 살펴보기`}
                            >
                              <Portrait character={c} />
                              <span className="card-shade" />
                              <span className="card-genre">{c.art_style}</span>
                              <span className="card-overline">{c.genre}</span>
                            </button>
                            <button
                              className={`save-button ${saved.includes(c.id) ? "saved" : ""}`}
                              aria-label={`${c.name} 책갈피`}
                              aria-pressed={saved.includes(c.id)}
                              onClick={() => toggleSave(c.id)}
                            >
                              <Bookmark
                                size={18}
                                fill={
                                  saved.includes(c.id) ? "currentColor" : "none"
                                }
                              />
                            </button>
                          </div>
                          <button
                            className="card-title"
                            onClick={() => setDetail(c)}
                          >
                            <h3>
                              {c.name}
                              <span>{c.age}세</span>
                            </h3>
                            <ArrowUpRight size={19} />
                          </button>
                          <p className="card-role">
                            {c.headline.replace("\n", " ")}
                          </p>
                          <div className="tags">
                            {c.tags.slice(0, 3).map((t) => (
                              <span key={t}>#{t}</span>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                    {!loading && !filtered.length && (
                      <div className="empty">
                        <Search />
                        <h3>
                          {tab === "saved"
                            ? "책갈피를 남겨보세요."
                            : "아직 이 취향의 이야기가 없어요."}
                        </h3>
                        <p>선택한 성별, 그림체 또는 검색어를 바꿔보세요.</p>
                        <button
                          className="primary"
                          onClick={() => {
                            setQuery("");
                            setGenre("전체");
                            setGender("전체");
                            setArtStyle("전체");
                            setTab("discover");
                          }}
                        >
                          모든 인연 보기
                        </button>
                      </div>
                    )}
                  </>
                )}
                {tab === "chats" && (
                  <div className="conversation-list">
                    {convs.map((c) => {
                      const char = characters.find(
                        (x) => x.id === c.character_id,
                      );
                      return char ? (
                        <button
                          className="conversation-row"
                          key={c.id}
                          onClick={() => openChat(char, c.id)}
                        >
                          <Portrait character={char} />
                          <div>
                            <h3>
                              {char.name}
                              <span>{c.relationship.stage}</span>
                            </h3>
                            <p>{char.role}</p>
                          </div>
                          <span className="conversation-date">
                            {new Date(c.updated * 1000).toLocaleDateString(
                              "ko-KR",
                              { month: "short", day: "numeric" },
                            )}
                          </span>
                          <ChevronRight size={20} />
                        </button>
                      ) : null;
                    })}
                    {!convs.length && (
                      <div className="empty">
                        <MessageCircle />
                        <h3>첫 번째 이야기가 기다려요.</h3>
                        <p>마음에 드는 캐릭터에게 첫인사를 건네보세요.</p>
                        <button
                          className="primary"
                          onClick={() => setTab("discover")}
                        >
                          인연 만나러 가기
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {loading && (
                  <div className="empty">
                    <span className="spinner" />
                    <p>새로운 인연을 불러오고 있어요.</p>
                  </div>
                )}
              </section>
              <footer className="page-footer">
                <span className="footer-brand">talevi.</span>
                <span>✦</span>
                <small>
                  모든 오리지널 캐릭터는 성인이며 가상의 인물입니다.
                </small>
              </footer>
            </div>
          </>
        )}
        {chat && current && (
          <div className="chat-workspace">
            <section className="chat-center">
              <header className="chat-header">
                <button
                  className="icon-button"
                  aria-label="대화 목록으로"
                  onClick={closeChat}
                >
                  <ArrowLeft size={21} />
                </button>
                <Portrait character={current} className="chat-avatar" />
                <div className="chat-identity">
                  <h2>
                    {current.name}
                    <span>AI</span>
                  </h2>
                  <small>
                    {chat.relationship.stage} <span>—</span> 제{" "}
                    {chat.narrative.chapter}장
                  </small>
                </div>
                <button className="chat-wallet" onClick={openWallet}>
                  <Sparkles size={16} />
                  {user?.credits}
                </button>
                <button
                  className={`icon-button panel-toggle ${showPanel ? "pressed" : ""}`}
                  aria-label="기억과 관계 보기"
                  onClick={() => setShowPanel(!showPanel)}
                >
                  <BookOpen size={21} />
                </button>
              </header>
              {demo && (
                <div className="demo-banner">
                  예시 답변으로 체험 중이에요. 실제 AI 연결은 준비 중입니다.
                </div>
              )}
              <div className="message-scroll">
                <div className="scene-intro">
                  <span className="eyebrow">우리의 첫 장면</span>
                  <h3>{current.role}</h3>
                  <p>{current.description}</p>
                  <span className="scene-line">✦</span>
                </div>
                {chat.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`message ${m.role} ${m.status === "failed" ? "failed" : ""}`}
                  >
                    {m.role === "assistant" && (
                      <span className="message-author">{current.name}</span>
                    )}
                    <div className="message-bubble">
                      <RichText text={m.content} />
                    </div>
                    {m.status === "failed" && (
                      <small>전송한 대화의 답변을 완료하지 못했어요.</small>
                    )}
                    {m.role === "assistant" && (
                      <div className="message-actions">
                        <button
                          aria-label="답변 의견 남기기"
                          onClick={() => setFeedback(m.id)}
                        >
                          <Flag size={13} />
                          <span>의견 남기기</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {sending && (
                  <div className="message assistant">
                    <span className="message-author">{current.name}</span>
                    <div className="message-bubble streaming">
                      {stream ? (
                        <RichText text={stream} />
                      ) : (
                        <span className="typing">
                          <i />
                          <i />
                          <i />
                          <small>답장을 생각하고 있어요</small>
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <div ref={bottom} />
              </div>
              <div className="composer-wrap">
                {chat.messages.length === 1 && !sending && (
                  <div className="starters">
                    {current.starters.map((s) => (
                      <button key={s} onClick={() => send(s)}>
                        {s}
                        <ArrowUpRight size={13} />
                      </button>
                    ))}
                  </div>
                )}
                <div className="story-tools">
                  <span>
                    <Feather size={14} />
                    다음 장면
                  </span>
                  <button
                    disabled={sending}
                    onClick={() =>
                      send("주변에 새로운 단서가 있는지 살펴본다.", "discovery")
                    }
                  >
                    새로운 발견
                  </button>
                  <button
                    disabled={sending}
                    onClick={() =>
                      send("함께 다른 장소로 걸어갈까?", "change_scene")
                    }
                  >
                    장소 바꾸기
                  </button>
                  <button
                    disabled={sending}
                    onClick={() => send("잠깐 같이 쉬고 싶어.", "quiet")}
                  >
                    잠시 쉬어가기
                  </button>
                </div>
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <textarea
                    ref={input}
                    aria-label="메시지"
                    placeholder={`${current.name}에게 하고 싶은 말…`}
                    value={draft}
                    maxLength={3000}
                    onChange={(e) => updateDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div className="composer-bottom">
                    <label className="mode-select">
                      <Sparkles size={14} />
                      <select
                        aria-label="대화 모드"
                        value={mode}
                        disabled={sending}
                        onChange={(e) =>
                          setMode(e.target.value as "quick" | "story")
                        }
                      >
                        <option value="quick">짧은 대화 · 1 빛</option>
                        <option value="story">깊은 이야기 · 3 빛</option>
                      </select>
                    </label>
                    <span className="input-hint">
                      {draft.length > 2500
                        ? `${draft.length}/3000`
                        : "Shift + Enter 줄바꿈"}
                    </span>
                    <button
                      className="send-button"
                      type="submit"
                      disabled={sending || !draft.trim()}
                      aria-label="메시지 보내기"
                    >
                      <Send size={18} />
                    </button>
                  </div>
                </form>
                <div className="composer-disclaimer">
                  {ko.aiNotice} <span>소중한 개인정보는 입력하지 마세요.</span>
                </div>
              </div>
            </section>
            <aside className={`chat-side ${showPanel ? "open" : ""}`}>
              <div className="chat-side-art">
                <Portrait character={current} />
                <div />
                <h3>
                  {current.name}
                  <small>{current.role}</small>
                </h3>
                <button
                  className="icon-button close-side"
                  onClick={() => setShowPanel(false)}
                  aria-label="정보 닫기"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="panel-tabs" role="group" aria-label="대화 정보">
                {(
                  [
                    { id: "memory", label: "기억 노트" },
                    { id: "relation", label: "우리 사이" },
                    { id: "settings", label: "설정" },
                  ] as const
                ).map((p) => (
                  <button
                    className={panel === p.id ? "active" : ""}
                    key={p.id}
                    onClick={() => setPanel(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="panel-content">
                {panel === "memory" && (
                  <>
                    <div className="panel-heading">
                      <h3>잊지 않을 이야기</h3>
                      <button
                        className="icon-button"
                        aria-label="기억 추가"
                        disabled={sending}
                        onClick={() => {
                          setShowMemoryForm(true);
                          setMemoryEdit(null);
                          setMemoryValue("");
                          setMemoryKey("");
                        }}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    <p className="panel-description">
                      이름과 취향, 함께 정한 약속을 기억해요.
                      <br />
                      틀린 기억은 고치고, 언제든 지울 수 있어요.
                    </p>
                    {!chat.memories.length && (
                      <div className="memory-empty">
                        <Leaf size={25} />
                        <p>아직은 빈 페이지예요.</p>
                        <small>“내 이름은…” 하고 시작해 보세요.</small>
                      </div>
                    )}
                    {chat.memories.map((m) => (
                      <div className="memory-card" key={m.id}>
                        <span>
                          {m.locked ? (
                            <LockKeyhole size={12} />
                          ) : (
                            <Leaf size={12} />
                          )}{" "}
                          {m.key}
                        </span>
                        <p>{m.value}</p>
                        <footer>
                          <small>
                            {m.locked
                              ? "직접 저장한 기억"
                              : "대화에서 기억했어요"}
                          </small>
                          <button
                            disabled={sending}
                            aria-label={`${m.key} 수정`}
                            onClick={() => {
                              setMemoryEdit(m);
                              setMemoryValue(m.value);
                              setShowMemoryForm(true);
                            }}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            disabled={sending}
                            aria-label={`${m.key} 삭제`}
                            onClick={() => deleteMemory(m)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </footer>
                      </div>
                    ))}
                    {(!!chat.narrative.episode_notes?.length ||
                      Object.keys(chat.narrative.story_slots ?? {}).length >
                        0) && (
                      <section aria-label="이전 이야기의 장면">
                        <h3>기억에 남은 장면</h3>
                        <p className="panel-description">
                          함께 나눈 장면을 이어서 기억해요. 이름이나 취향을
                          고쳐도 다른 이야기는 그대로 남아요.
                        </p>
                        {(chat.narrative.episode_notes ?? []).map((note) => (
                          <div className="memory-card" key={note.source_id}>
                            <span>
                              {note.role === "user"
                                ? "내가 남긴 말"
                                : current?.name + "의 말"}
                            </span>
                            <p>{note.quote}</p>
                          </div>
                        ))}
                        <button
                          className="text-button"
                          disabled={sending}
                          onClick={async () => {
                            try {
                              await api(
                                `/v1/conversations/${chat.id}/episodes`,
                                { method: "DELETE" },
                              );
                              await refreshChat(chat.id);
                              notify(
                                "이전 장면을 지웠어요. 별도로 저장한 기억 노트는 남아 있어요.",
                              );
                            } catch (e) {
                              notify((e as Error).message);
                            }
                          }}
                        >
                          이전 장면 지우기
                        </button>
                        <p className="panel-description">
                          이름, 취향, 약속 등의 기억 노트는 남아 있어요.
                          지우려면 각 노트의 삭제 버튼을 눌러 주세요.
                        </p>
                      </section>
                    )}
                    <div className="privacy-note">
                      <LockKeyhole size={14} />
                      <span>
                        이 대화의 기억은 다른 캐릭터에게 공유되지 않아요.
                      </span>
                    </div>
                  </>
                )}
                {panel === "relation" && (
                  <>
                    <div className="relationship-art">
                      <Heart size={30} />
                      <span>우리 사이</span>
                      <h3>{chat.relationship.stage}</h3>
                      <p>대화를 나누며 천천히 알아가는 중</p>
                    </div>
                    <div className="trust-track">
                      <div style={{ width: chat.relationship.trust + "%" }} />
                    </div>
                    <div className="relationship-stats">
                      <div>
                        <strong>{chat.relationship.trust}</strong>
                        <span>쌓아온 신뢰</span>
                      </div>
                      <div>
                        <strong>{chat.relationship.shared}</strong>
                        <span>함께 협력한 순간</span>
                      </div>
                    </div>
                    {chat.relationship.last_change && (
                      <div className="memory-card">
                        <strong>{chat.relationship.last_change.reason}</strong>
                        <p>“{chat.relationship.last_change.evidence}”</p>
                        <span>
                          {chat.relationship.last_change.delta > 0
                            ? "서로를 조금 더 믿게 된 순간"
                            : chat.relationship.last_change.delta < 0
                              ? "서두르지 않고 마음을 풀어갈 시간"
                              : "당신이 정한 속도와 거리를 기억해요"}
                        </span>
                      </div>
                    )}
                    <div className="chapter-card">
                      <BookOpen size={18} />
                      <h4>제 {chat.narrative.chapter}장</h4>
                      <p>
                        {chat.narrative.last_event === "discovery"
                          ? "새로운 단서를 마주하며"
                          : chat.narrative.last_event === "change_scene"
                            ? "다른 풍경을 향해"
                            : chat.narrative.last_event === "quiet"
                              ? "함께 쉬어가는 시간"
                              : "처음 마주친 순간"}
                      </p>
                    </div>
                    {Object.values(chat.narrative.story_slots ?? {})
                      .filter(
                        (item) =>
                          item.status === "active" &&
                          !item.key.startsWith("past."),
                      )
                      .slice(0, 4)
                      .map((item) => (
                        <div className="memory-card" key={item.key}>
                          <strong>
                            {item.key === "scene.goal"
                              ? "지금의 목표"
                              : item.key === "scene.place"
                                ? "이야기가 머무는 곳"
                                : "이어갈 이야기"}
                          </strong>
                          <p>{item.value}</p>
                          <small>
                            {item.source === "user"
                              ? "내가 남긴 말에서"
                              : "함께 나눈 장면에서"}
                          </small>
                        </div>
                      ))}
                    <p className="panel-description">
                      관계는 결제 금액이나 접속 일수로 바뀌지 않아요. 서로의
                      말과 선택이 쌓여 만들어져요.
                    </p>
                  </>
                )}
                {panel === "settings" && (
                  <>
                    <h3>내가 편한 대화</h3>
                    <label className="setting-row">
                      <span>
                        대화 기억 사용하기
                        <small>이름, 취향과 이전 장면을 참고해요.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={chat.settings.memory_enabled}
                        disabled={sending}
                        onChange={(e) =>
                          settingsChange({
                            ...chat.settings,
                            memory_enabled: e.target.checked,
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      관계의 속도
                      <select
                        disabled={sending}
                        value={chat.settings.pace}
                        onChange={(e) =>
                          settingsChange({
                            ...chat.settings,
                            pace: e.target.value as "slow" | "natural",
                          })
                        }
                      >
                        <option value="slow">천천히 알아가기</option>
                        <option value="natural">자연스러운 속도로</option>
                      </select>
                    </label>
                    <label className="field">
                      답변 분량
                      <select
                        disabled={sending}
                        value={chat.settings.length}
                        onChange={(e) =>
                          settingsChange({
                            ...chat.settings,
                            length: e.target.value as
                              "short" | "balanced" | "long",
                          })
                        }
                      >
                        <option value="short">짧고 간결하게</option>
                        <option value="balanced">대사와 묘사를 적당히</option>
                        <option value="long">풍부한 묘사로</option>
                      </select>
                    </label>
                    <p className="panel-description">
                      기억을 수정하거나 지우면, 변경 전 대화는 이후 답변의 참고
                      자료에서 제외해요. 화면의 대화 기록은 그대로 남아요.
                    </p>
                  </>
                )}
              </div>
            </aside>
          </div>
        )}
      </main>
      {error && (
        <div role="alert" className="error-toast">
          <span>{error}</span>
          {pendingRetry && chat && (
            <button
              disabled={sending}
              onClick={() =>
                send(pendingRetry.content, pendingRetry.story_event, true)
              }
            >
              <RefreshCw size={14} />
              같은 메시지 재시도
            </button>
          )}
          {!characters.length && (
            <button onClick={loadCatalog}>다시 불러오기</button>
          )}
          <button onClick={() => setError("")} aria-label="오류 닫기">
            <X size={17} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="toast">
          <Check size={17} />
          {notice}
        </div>
      )}
      {detail && (
        <Modal
          error={error}
          title="이야기 미리보기"
          onClose={() => setDetail(null)}
          wide
        >
          <div className="detail-layout">
            <Portrait character={detail} />
            <div className="detail-copy">
              <span className="eyebrow">
                {detail.art_style} / 테일비 오리지널
              </span>
              <h2>
                {detail.name}
                <span>{detail.age}세</span>
              </h2>
              <h3>{detail.role}</h3>
              <p>{detail.description}</p>
              <div className="tags">
                {detail.tags.map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
              <div className="first-line">
                <span>이야기의 첫 문장</span>
                <p>
                  <RichText text={detail.opening} />
                </p>
              </div>
              <div className="detail-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => openChat(detail)}
                >
                  {busy ? "이야기를 여는 중…" : ko.start}
                  <ArrowRight size={17} />
                </button>
                <button
                  className="secondary"
                  onClick={() => toggleSave(detail.id)}
                  aria-label="책갈피에 저장"
                >
                  <Bookmark
                    size={18}
                    fill={saved.includes(detail.id) ? "currentColor" : "none"}
                  />
                </button>
              </div>
              <small className="muted">
                첫 만남 선물 30 빛 · 짧은 대화 1 빛부터
              </small>
            </div>
          </div>
        </Modal>
      )}
      {modal === "wallet" && (
        <Modal
          error={error}
          title="이야기를 이어갈 빛"
          onClose={() => setModal(null)}
        >
          <div className="balance">
            <Sparkles size={26} />
            <span>나의 빛</span>
            <strong>{wallet?.credits ?? user?.credits ?? 0}</strong>
          </div>
          <p className="modal-description">
            짧은 대화는 1 빛, 깊은 이야기는 3 빛.
            <br />
            답변이 실패하면 사용한 빛을 돌려드려요.
          </p>
          {demo && (
            <p className="callout">
              테스트 충전입니다. 실제 금액은 청구되지 않아요.
            </p>
          )}
          <div className="packages">
            {[
              { sku: "light-500", credits: 500, price: 4900 },
              { sku: "light-1200", credits: 1200, price: 9900 },
            ].map((p) => (
              <button
                disabled={busy || !wallet?.available}
                onClick={() => purchase(p.sku)}
                key={p.sku}
              >
                <span>
                  <Sparkles size={19} />
                  <strong>{p.credits.toLocaleString("ko-KR")} 빛</strong>
                </span>
                <span>
                  {demo
                    ? "테스트 충전"
                    : p.price.toLocaleString("ko-KR") + "원"}
                  <ChevronRight size={16} />
                </span>
              </button>
            ))}
          </div>
          {wallet && !wallet.available && (
            <p className="callout">결제 서비스 연결을 준비하고 있어요.</p>
          )}
          <p className="fineprint">
            자동으로 충전되거나 구독되지 않아요. 구매 전 표시된 금액으로 한 번만
            결제합니다.
          </p>
          <h3 className="ledger-title">최근 이용 내역</h3>
          <div className="ledger">
            {wallet?.entries.map((e) => (
              <div key={e.id}>
                <span>
                  {e.reason}
                  <small>
                    {new Date(e.created * 1000).toLocaleDateString("ko-KR")}
                  </small>
                </span>
                <strong className={e.delta > 0 ? "positive" : ""}>
                  {e.delta > 0 ? "+" : ""}
                  {e.delta}
                </strong>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === "account" && (
        <Modal
          error={error}
          title={user?.email ? "나의 계정" : "이야기를 오래 간직하세요"}
          onClose={() => setModal(null)}
        >
          <button className="secondary" onClick={openWallet}>
            <Sparkles size={16} />
            나의 빛 {user?.credits ?? 30}
          </button>
          {user?.email ? (
            <>
              <div className="account-profile">
                <span className="avatar">
                  <UserRound />
                </span>
                <h3>{user.nickname}</h3>
                <p>{user.email}</p>
              </div>
              <button className="settings-action" onClick={exportData}>
                <Download size={19} />
                대화와 기억 내려받기
                <ChevronRight size={17} />
              </button>
              <button
                className="settings-action"
                onClick={async () => {
                  await api("/v1/auth/logout", { method: "POST" });
                  setUser(null);
                  setConvs([]);
                  closeChat();
                  setModal(null);
                  void loadCatalog();
                }}
              >
                <LogOut size={19} />
                로그아웃
              </button>
            </>
          ) : (
            <>
              <p className="modal-description">
                이메일로 계정을 저장하면 다른 기기에서도
                <br />
                캐릭터와의 대화와 기억을 이어갈 수 있어요.
              </p>
              <div className="auth-tabs">
                <button
                  className={authMode === "register" ? "selected" : ""}
                  onClick={() => setAuthMode("register")}
                >
                  계정 만들기
                </button>
                <button
                  className={authMode === "login" ? "selected" : ""}
                  onClick={() => setAuthMode("login")}
                >
                  로그인
                </button>
              </div>
              <form onSubmit={auth} className="form-stack">
                {authMode === "register" && (
                  <label className="field">
                    어떻게 불러드릴까요?
                    <input
                      name="nickname"
                      required
                      maxLength={30}
                      autoComplete="nickname"
                      placeholder="여행자"
                    />
                  </label>
                )}
                <label className="field">
                  이메일
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                  />
                </label>
                <label className="field">
                  비밀번호
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete={
                      authMode === "register"
                        ? "new-password"
                        : "current-password"
                    }
                    placeholder="12자 이상 입력해 주세요"
                  />
                </label>
                <button className="primary" disabled={busy}>
                  {busy
                    ? "잠시만 기다려 주세요…"
                    : authMode === "register"
                      ? "지금까지의 이야기 저장하기"
                      : "내 이야기로 돌아가기"}
                </button>
                <p className="fineprint">
                  현재 개발 버전에서는 이메일 확인과 비밀번호 재설정을 지원하지
                  않습니다.
                </p>
              </form>
            </>
          )}
        </Modal>
      )}
      {showMemoryForm && (
        <Modal
          error={error}
          title={memoryEdit ? "기억 고치기" : "기억 남기기"}
          onClose={() => setShowMemoryForm(false)}
        >
          <div className="form-stack">
            {!memoryEdit && (
              <label className="field">
                기억의 제목
                <input
                  value={memoryKey}
                  maxLength={40}
                  onChange={(e) => setMemoryKey(e.target.value)}
                  placeholder="좋아하는 음악"
                />
              </label>
            )}
            <label className="field">
              꼭 기억해 줬으면 하는 것
              <textarea
                value={memoryValue}
                maxLength={500}
                onChange={(e) => setMemoryValue(e.target.value)}
                placeholder="나는 비 오는 날 재즈를 듣는 걸 좋아해."
              />
            </label>
            <p className="fineprint">
              직접 고친 기억은 자동으로 덮어쓰지 않아요.
            </p>
            <button
              className="primary"
              onClick={saveMemory}
              disabled={
                busy ||
                !memoryValue.trim() ||
                (!memoryEdit && !memoryKey.trim())
              }
            >
              기억 저장하기
            </button>
          </div>
        </Modal>
      )}
      {feedback && (
        <Modal
          error={error}
          title="어떤 답변이었나요?"
          onClose={() => setFeedback(null)}
        >
          <p className="modal-description">
            캐릭터의 다음 이야기를 더 좋게 만드는 데 도움이 돼요.
          </p>
          <div className="feedback-options">
            {[
              "좋아요",
              "기억 오류",
              "반복되는 답변",
              "캐릭터 불일치",
              "부적절한 내용",
            ].map((reason) => (
              <button
                key={reason}
                onClick={async () => {
                  try {
                    await api("/v1/feedback", {
                      method: "POST",
                      body: JSON.stringify({ message_id: feedback, reason }),
                    });
                    setFeedback(null);
                    notify("의견을 남겼어요. 감사합니다.");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {reason}
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === "create" && (
        <Modal
          error={error}
          title="세상에 하나뿐인 캐릭터"
          onClose={() => setModal(null)}
          wide
        >
          <form className="create-form" onSubmit={createCharacter}>
            <p className="modal-description">
              얼굴뿐 아니라 말투, 세계관, 첫인사까지.
              <br />
              지금은 나만 볼 수 있는 캐릭터로 만들어져요.
            </p>
            <div className="form-columns">
              <label className="field">
                이름
                <input name="name" required maxLength={30} />
              </label>
              <label className="field">
                나이
                <input
                  name="age"
                  type="number"
                  required
                  min={20}
                  max={1000}
                  defaultValue={29}
                />
              </label>
              <label className="field">
                성별
                <select name="gender">
                  <option>남성</option>
                  <option>여성</option>
                  <option>기타</option>
                </select>
              </label>
              <label className="field">
                장르
                <select name="genre">
                  {genres.slice(1).map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                그림체
                <select name="art_style">
                  <option>애니메이션</option>
                  <option>반실사</option>
                </select>
              </label>
            </div>
            <label className="field">
              이 사람을 한 줄로 소개하면
              <input
                name="role"
                required
                minLength={2}
                maxLength={60}
                placeholder="잊힌 마을의 우편배달부"
              />
            </label>
            <label className="field">
              어떤 매력이 있나요?
              <textarea
                name="description"
                required
                minLength={10}
                maxLength={600}
              />
            </label>
            <fieldset>
              <legend>한눈에 알아볼 수 있는 외형</legend>
              <div className="form-columns">
                {[
                  ["face", "얼굴형과 피부", "둥근 얼굴, 햇볕에 탄 피부"],
                  ["hair", "머리 모양", "곱슬머리, 옆머리를 짧게"],
                  ["build", "체형과 자세", "넓은 어깨, 늘 바른 자세"],
                  ["signature", "고유한 특징", "왼쪽 눈 밑의 작은 점"],
                ].map(([name, label, placeholder]) => (
                  <label className="field" key={name}>
                    {label}
                    <input
                      name={name}
                      required
                      minLength={3}
                      maxLength={200}
                      placeholder={placeholder}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              말투와 성격
              <textarea
                name="voice"
                required
                minLength={10}
                maxLength={600}
                placeholder="문장을 짧게 끊고, 친해지면 건조한 농담을 한다."
              />
            </label>
            <label className="field">
              둘이 만나게 되는 세계
              <textarea name="world" required minLength={10} maxLength={1200} />
            </label>
            <label className="field">
              사용자에게 건네는 첫인사
              <textarea
                name="opening"
                required
                minLength={10}
                maxLength={1200}
              />
            </label>
            <p className="fineprint">
              성인인 가상의 인물만 만들어 주세요. 사진 없이 고유한 이름 카드로
              시작합니다.
            </p>
            <button className="primary" disabled={busy}>
              {busy ? "캐릭터를 만드는 중…" : "나의 캐릭터 만들기"}
              <Feather size={17} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
