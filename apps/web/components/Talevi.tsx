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
  ArrowDown,
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
  GitBranch,
} from "lucide-react";
import {
  ko,
  type Character,
  type Conversation,
  type ConversationSummary,
  type User,
  type Memory,
  type Message,
  type BranchAction,
  type BranchRequest,
  type BranchResult,
  ApiError,
} from "@yeoun/contracts";
import { api, followTurn, waitForApi } from "@/lib/api";
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
type PendingTurn = {
  client_id: string;
  content: string;
  mode: "quick" | "story";
  story_event: string | null;
};
const pendingTurnKey = (cid: string) => `talevi-pending:v1:${cid}`;
function readPendingTurn(cid: string): PendingTurn | null {
  try {
    const raw = localStorage.getItem(pendingTurnKey(cid));
    if (!raw) return null;
    const record = JSON.parse(raw),
      body = record?.body;
    if (
      record?.version !== 1 ||
      !body ||
      typeof body.client_id !== "string" ||
      !/^[a-zA-Z0-9_-]{16,64}$/.test(body.client_id) ||
      typeof body.content !== "string" ||
      !body.content.trim() ||
      body.content.length > 3000 ||
      !["quick", "story"].includes(body.mode) ||
      ![null, "discovery", "change_scene", "quiet"].includes(body.story_event)
    ) {
      localStorage.removeItem(pendingTurnKey(cid));
      return null;
    }
    return {
      client_id: body.client_id,
      content: body.content,
      mode: body.mode,
      story_event: body.story_event,
    };
  } catch {
    return null;
  }
}
function savePendingTurn(cid: string, body: PendingTurn) {
  try {
    localStorage.setItem(
      pendingTurnKey(cid),
      JSON.stringify({ version: 1, body }),
    );
  } catch {
    throw new Error(
      "전송 상태를 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.",
    );
  }
}
function clearPendingTurn(cid: string, clientId: string) {
  try {
    if (readPendingTurn(cid)?.client_id === clientId)
      localStorage.removeItem(pendingTurnKey(cid));
  } catch {
    // Keeping a receipt is safe: its idempotency key will recover the same turn.
  }
}
type PendingBranch = { body: BranchRequest; result?: BranchResult };
const pendingBranchKey = (cid: string) => `talevi-branch:v1:${cid}`;
function readPendingBranch(cid: string): PendingBranch | null {
  try {
    const raw = localStorage.getItem(pendingBranchKey(cid));
    if (!raw) return null;
    const record = JSON.parse(raw),
      body = record?.body,
      result = record?.result;
    if (
      record?.version !== 1 ||
      !body ||
      typeof body.client_id !== "string" ||
      !/^[a-zA-Z0-9_-]{16,64}$/.test(body.client_id) ||
      typeof body.message_id !== "string" ||
      !body.message_id ||
      !["branch", "regenerate", "edit"].includes(body.action) ||
      (body.action === "edit" &&
        (typeof body.content !== "string" ||
          !body.content.trim() ||
          body.content.length > 3000)) ||
      (result !== undefined &&
        (typeof result.conversation_id !== "string" ||
          !(result.turn_id === null || typeof result.turn_id === "string") ||
          typeof result.status !== "string" ||
          typeof result.cost !== "number"))
    ) {
      localStorage.removeItem(pendingBranchKey(cid));
      return null;
    }
    return { body, ...(result ? { result } : {}) };
  } catch {
    return null;
  }
}
function savePendingBranch(cid: string, record: PendingBranch) {
  try {
    localStorage.setItem(
      pendingBranchKey(cid),
      JSON.stringify({ version: 1, ...record }),
    );
  } catch {
    throw new Error(
      "이야기 전환 상태를 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.",
    );
  }
}
function clearPendingBranch(cid: string, clientId: string) {
  try {
    if (readPendingBranch(cid)?.body.client_id === clientId)
      localStorage.removeItem(pendingBranchKey(cid));
  } catch {
    // Retaining the request is safe: retry recovers the same branch.
  }
}
const branchLabels: Record<BranchAction, string> = {
  branch: "여기서 다른 이야기",
  regenerate: "다른 답변 받기",
  edit: "내 메시지 수정",
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
    [pendingRetry, setPendingRetry] = useState<PendingTurn | null>(null);
  const [branchDialog, setBranchDialog] = useState<{
      message: Message;
      action: BranchAction;
    } | null>(null),
    [branchContent, setBranchContent] = useState(""),
    [pendingBranch, setPendingBranch] = useState<PendingBranch | null>(null),
    [branching, setBranching] = useState(false);
  const [replyPhase, setReplyPhase] = useState<"thinking" | "writing">(
      "thinking",
    ),
    [connection, setConnection] = useState<"connected" | "reconnecting">(
      "connected",
    ),
    [resumeTurn, setResumeTurn] = useState<{ cid: string; tid: string } | null>(
      null,
    ),
    [showLatest, setShowLatest] = useState(false);
  const controller = useRef<AbortController | null>(null),
    catalogController = useRef<AbortController | null>(null),
    messageScroll = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    sendLock = useRef(false),
    viewEpoch = useRef(0),
    activeChatId = useRef<string | null>(null),
    draftRef = useRef(""),
    draftRevision = useRef(0),
    draftEdits = useRef(new Map<string, number>()),
    nearBottom = useRef(true);
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
    catalogController.current?.abort();
    const controller = new AbortController();
    catalogController.current = controller;
    setLoading(true);
    setError("");
    try {
      const health = await waitForApi(controller.signal);
      const catalog = await api<Character[]>("/v1/characters", {
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      setDemo(health.mode === "demo");
      setCharacters(catalog);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
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
    let disposed = false;
    void loadCatalog().then(() => {
      if (!disposed) void loadMe();
    });
    try {
      setSaved(JSON.parse(localStorage.getItem("yeoun-bookmarks") || "[]"));
    } catch {}
    return () => {
      disposed = true;
      catalogController.current?.abort();
      viewEpoch.current += 1;
      controller.current?.abort();
    };
  }, [loadCatalog, loadMe]);
  useEffect(() => {
    const node = messageScroll.current;
    if (!node) return;
    if (nearBottom.current) node.scrollTop = node.scrollHeight;
    else setShowLatest(true);
  }, [chat?.id, chat?.messages.length, stream, sending]);
  const jumpToLatest = () => {
    nearBottom.current = true;
    setShowLatest(false);
    const node = messageScroll.current;
    if (node) node.scrollTop = node.scrollHeight;
  };
  const isChatView = (cid: string, epoch: number) =>
    viewEpoch.current === epoch && activeChatId.current === cid;
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
  const refreshChat = async (id: string, epoch = viewEpoch.current) => {
    const c = await api<Conversation>(`/v1/conversations/${id}`);
    if (isChatView(id, epoch)) setChat(c);
    void loadMe();
    return c;
  };
  const turnIsSaved = (c: Conversation, tid: string) =>
    c.messages.some(
      (message) =>
        message.turn_id === tid &&
        (message.role === "assistant" || message.status === "failed"),
    );
  const listen = async (
    cid: string,
    tid: string,
    epoch = viewEpoch.current,
  ) => {
    if (!isChatView(cid, epoch)) return;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const isCurrent = () =>
      isChatView(cid, epoch) &&
      controller.current === ctrl &&
      !ctrl.signal.aborted;
    sendLock.current = true;
    setSending(true);
    setResumeTurn({ cid, tid });
    setReplyPhase("thinking");
    setConnection("connected");
    setStream("");
    try {
      await followTurn(
        tid,
        (item) => {
          if (!isCurrent()) return;
          if (item.event === "delta") {
            setReplyPhase("writing");
            setStream((s) => s + String(item.data.text));
          }
          if (
            item.event === "phase" &&
            (item.data.name === "thinking" || item.data.name === "writing")
          )
            setReplyPhase(item.data.name);
          if (item.event === "failed") {
            setError(String(item.data.message));
            setStream("");
          }
        },
        ctrl.signal,
        (state) => {
          if (isCurrent()) setConnection(state);
        },
      );
      if (!isCurrent()) return;
      const latest = await refreshChat(cid, epoch);
      if (isCurrent() && turnIsSaved(latest, tid)) setResumeTurn(null);
    } catch (e) {
      if (!isCurrent()) return;
      // The server may have saved the answer while the event connection was lost.
      try {
        const latest = await refreshChat(cid, epoch);
        if (!isCurrent()) return;
        if (turnIsSaved(latest, tid)) {
          setResumeTurn(null);
          setError("");
          return;
        }
      } catch {
        if (!isCurrent()) return;
      }
      setError((e as Error).message);
    } finally {
      if (isCurrent()) {
        setSending(false);
        setStream("");
        sendLock.current = false;
      }
    }
  };
  const reconnectReply = async () => {
    if (!resumeTurn || sendLock.current) return;
    const { cid, tid } = resumeTurn;
    const epoch = viewEpoch.current;
    if (!isChatView(cid, epoch)) return;
    sendLock.current = true;
    setSending(true);
    setConnection("reconnecting");
    setError("");
    try {
      const latest = await refreshChat(cid, epoch);
      if (!isChatView(cid, epoch)) return;
      if (turnIsSaved(latest, tid) && !latest.active_turn) {
        setResumeTurn(null);
        return;
      }
      await listen(cid, latest.active_turn || tid, epoch);
    } catch (e) {
      if (isChatView(cid, epoch)) setError((e as Error).message);
    } finally {
      if (isChatView(cid, epoch)) {
        setSending(false);
        sendLock.current = false;
      }
    }
  };
  const openChat = async (c: Character, id?: string) => {
    const epoch = ++viewEpoch.current;
    activeChatId.current = null;
    controller.current?.abort();
    sendLock.current = false;
    setSending(false);
    setStream("");
    setResumeTurn(null);
    setPendingRetry(null);
    setPendingBranch(null);
    setBranchDialog(null);
    setBranching(false);
    setError("");
    setBusy(true);
    try {
      await ensureUser();
      if (epoch !== viewEpoch.current) return;
      const known = id || convs.find((x) => x.character_id === c.id)?.id;
      const cid =
        known ||
        (
          await api<{ id: string }>("/v1/conversations", {
            method: "POST",
            body: JSON.stringify({ character_id: c.id }),
          })
        ).id;
      if (epoch !== viewEpoch.current) return;
      activeChatId.current = cid;
      nearBottom.current = true;
      setShowLatest(false);
      const data = await refreshChat(cid, epoch);
      if (!isChatView(cid, epoch)) return;
      setPendingRetry(readPendingTurn(cid));
      setPendingBranch(readPendingBranch(cid));
      setDetail(null);
      draftRef.current = localStorage.getItem("yeoun-draft:" + cid) || "";
      draftRevision.current += 1;
      setDraft(draftRef.current);
      setShowPanel(false);
      if (data.active_turn) void listen(cid, data.active_turn, epoch);
    } catch (e) {
      if (epoch === viewEpoch.current) setError((e as Error).message);
    } finally {
      if (epoch === viewEpoch.current) setBusy(false);
    }
  };
  const closeChat = () => {
    viewEpoch.current += 1;
    activeChatId.current = null;
    controller.current?.abort();
    setChat(null);
    setSending(false);
    setStream("");
    setResumeTurn(null);
    setPendingRetry(null);
    setPendingBranch(null);
    setBranchDialog(null);
    setBranching(false);
    setShowLatest(false);
    setBusy(false);
    sendLock.current = false;
    setError("");
    void loadMe();
  };
  const send = async (
    text = draft,
    storyEvent: string | null = null,
    retry = false,
  ) => {
    if (
      !chat ||
      !text.trim() ||
      sendLock.current ||
      busy ||
      branching ||
      pendingBranch ||
      resumeTurn ||
      sending ||
      (pendingRetry && !retry)
    )
      return;
    const cid = chat.id,
      epoch = viewEpoch.current;
    if (!isChatView(cid, epoch)) return;
    const unfinishedBranch = readPendingBranch(cid);
    if (unfinishedBranch) {
      setPendingBranch(unfinishedBranch);
      setError("이야기 전환 결과를 먼저 확인해 주세요.");
      return;
    }
    const submittedRevision = draftRevision.current;
    const submittedDraft = draftRef.current;
    const submittedEdits = draftEdits.current.get(cid) || 0;
    sendLock.current = true;
    nearBottom.current = true;
    setShowLatest(false);
    setSending(true);
    setReplyPhase("thinking");
    setConnection("connected");
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
      const stored = readPendingTurn(cid);
      if (stored && stored.client_id !== body.client_id) {
        setPendingRetry(stored);
        throw new Error("이전 메시지의 전송 결과를 먼저 확인해 주세요.");
      }
      savePendingTurn(cid, body);
      const turn = await api<{ id: string }>(`/v1/conversations/${cid}/turns`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      clearPendingTurn(cid, body.client_id);
      // A confirmed send owns this stored draft even after navigation, but never
      // a draft the user edited while the request was waiting.
      const unchangedSubmittedDraft =
        submittedDraft.trim() === body.content.trim() &&
        (draftEdits.current.get(cid) || 0) === submittedEdits;
      if (
        unchangedSubmittedDraft &&
        localStorage.getItem("yeoun-draft:" + cid) === submittedDraft
      )
        localStorage.removeItem("yeoun-draft:" + cid);
      if (!isChatView(cid, epoch)) return;
      if (
        unchangedSubmittedDraft &&
        draftRevision.current === submittedRevision &&
        draftRef.current === submittedDraft
      ) {
        draftRef.current = "";
        setDraft("");
      }
      setPendingRetry(null);
      setResumeTurn({ cid, tid: turn.id });
      const latest = await refreshChat(cid, epoch);
      if (!isChatView(cid, epoch)) return;
      if (turnIsSaved(latest, turn.id)) {
        setResumeTurn(null);
        setStream("");
        setSending(false);
        sendLock.current = false;
      } else {
        await listen(cid, turn.id, epoch);
      }
    } catch (e) {
      const rejected =
        e instanceof ApiError &&
        [400, 401, 403, 404, 402, 422].includes(e.status);
      if (rejected) clearPendingTurn(cid, body.client_id);
      if (!isChatView(cid, epoch)) return;
      setError((e as Error).message);
      if (rejected) setPendingRetry(null);
      if (e instanceof ApiError && e.status === 402) void openWallet();
      setSending(false);
      sendLock.current = false;
    }
  };
  const updateDraft = (s: string) => {
    draftRef.current = s;
    draftRevision.current += 1;
    setDraft(s);
    if (chat) {
      draftEdits.current.set(
        chat.id,
        (draftEdits.current.get(chat.id) || 0) + 1,
      );
      localStorage.setItem("yeoun-draft:" + chat.id, s);
    }
  };
  const chooseBranchAction = (message: Message, action: BranchAction) => {
    if (
      !message.actions?.[action] ||
      busy ||
      sending ||
      branching ||
      sendLock.current ||
      resumeTurn ||
      pendingRetry ||
      pendingBranch
    )
      return;
    if (
      action !== "branch" &&
      !(typeof message.action_cost === "number" && message.action_cost > 0)
    )
      return;
    setError("");
    setBranchContent(action === "edit" ? message.content : "");
    setBranchDialog({ message, action });
  };
  const runBranchAction = async (record: PendingBranch) => {
    if (
      !chat ||
      busy ||
      sending ||
      branching ||
      sendLock.current ||
      resumeTurn ||
      pendingRetry
    )
      return;
    const cid = chat.id,
      epoch = viewEpoch.current,
      { body } = record;
    if (!isChatView(cid, epoch)) return;
    sendLock.current = true;
    setBranching(true);
    setError("");
    let resultKnown = !!record.result;
    try {
      const unfinishedTurn = readPendingTurn(cid);
      if (unfinishedTurn) {
        setPendingRetry(unfinishedTurn);
        throw new Error("이전 메시지의 전송 결과를 먼저 확인해 주세요.");
      }
      const stored = readPendingBranch(cid);
      if (stored && stored.body.client_id !== body.client_id) {
        setPendingBranch(stored);
        throw new Error("이전 이야기 전환 결과를 먼저 확인해 주세요.");
      }
      const pending = stored || record;
      savePendingBranch(cid, pending);
      setPendingBranch(pending);
      setBranchDialog(null);
      const result =
        pending.result ||
        (await api<BranchResult>(`/v1/conversations/${cid}/branches`, {
          method: "POST",
          body: JSON.stringify(body),
        }));
      resultKnown = true;
      // Persist the receipt even after navigating away. Reopening the source
      // recovers this exact branch without charging for another generation.
      const receipt = { body, result };
      if (readPendingBranch(cid)?.body.client_id === body.client_id)
        savePendingBranch(cid, receipt);
      if (!isChatView(cid, epoch)) return;
      setPendingBranch(receipt);
      const next = await api<Conversation>(
        `/v1/conversations/${result.conversation_id}`,
      );
      if (!isChatView(cid, epoch)) return;
      const nextDraft = localStorage.getItem("yeoun-draft:" + next.id) || "";
      const nextEpoch = ++viewEpoch.current;
      activeChatId.current = next.id;
      controller.current?.abort();
      controller.current = null;
      clearPendingBranch(cid, body.client_id);
      setChat(next);
      setPendingBranch(readPendingBranch(next.id));
      setPendingRetry(readPendingTurn(next.id));
      setResumeTurn(null);
      setStream("");
      setBranchDialog(null);
      setBranching(false);
      setShowPanel(false);
      nearBottom.current = true;
      setShowLatest(false);
      draftRef.current = nextDraft;
      draftRevision.current += 1;
      setDraft(nextDraft);
      sendLock.current = false;
      void loadMe();
      notify(
        body.action === "branch"
          ? "새 갈래의 이야기를 열었어요."
          : "새 갈래에서 이야기를 이어가요.",
      );
      const tid = next.active_turn || result.turn_id;
      if (tid && !turnIsSaved(next, tid)) void listen(next.id, tid, nextEpoch);
    } catch (e) {
      const rejected =
        !resultKnown &&
        e instanceof ApiError &&
        [400, 401, 402, 403, 404, 409, 422].includes(e.status);
      if (rejected) clearPendingBranch(cid, body.client_id);
      if (!isChatView(cid, epoch)) return;
      if (rejected) setPendingBranch(null);
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 402) void openWallet();
    } finally {
      if (isChatView(cid, epoch)) {
        setBranching(false);
        sendLock.current = false;
      }
    }
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
      const epoch = ++viewEpoch.current;
      activeChatId.current = cid;
      nearBottom.current = true;
      refreshChat(cid, epoch)
        .then((c) => {
          if (!isChatView(cid, epoch)) return;
          setPendingRetry(readPendingTurn(cid));
          setPendingBranch(readPendingBranch(cid));
          draftRef.current = localStorage.getItem("yeoun-draft:" + cid) || "";
          draftRevision.current += 1;
          setDraft(draftRef.current);
          if (c.active_turn) void listen(cid, c.active_turn, epoch);
        })
        .catch(() => {});
    }
  }, [characters.length]);
  const saveMemory = async () => {
    if (!chat || !memoryValue.trim()) return;
    const cid = chat.id,
      epoch = viewEpoch.current;
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
      await refreshChat(cid, epoch);
      if (!isChatView(cid, epoch)) return;
      setShowMemoryForm(false);
      setMemoryEdit(null);
      setMemoryValue("");
      setMemoryKey("");
      notify("기억 노트에 저장했어요.");
    } catch (e) {
      if (isChatView(cid, epoch)) setError((e as Error).message);
    } finally {
      if (isChatView(cid, epoch)) setBusy(false);
    }
  };
  const deleteMemory = async (m: Memory) => {
    if (!chat) return;
    const cid = chat.id,
      epoch = viewEpoch.current;
    try {
      await api(`/v1/memories/${m.id}`, { method: "DELETE" });
      await refreshChat(cid, epoch);
      if (!isChatView(cid, epoch)) return;
      notify("기억을 지웠어요. 이후 답변에 사용하지 않아요.");
    } catch (e) {
      if (isChatView(cid, epoch)) setError((e as Error).message);
    }
  };
  const settingsChange = async (next: Conversation["settings"]) => {
    if (!chat) return;
    const cid = chat.id,
      epoch = viewEpoch.current;
    try {
      await api(`/v1/conversations/${cid}/settings`, {
        method: "PATCH",
        body: JSON.stringify(next),
      });
      if (isChatView(cid, epoch))
        setChat((current) =>
          current?.id === cid ? { ...current, settings: next } : current,
        );
    } catch (e) {
      if (isChatView(cid, epoch)) setError((e as Error).message);
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
      closeChat();
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
  const chatUnavailable =
    busy ||
    sending ||
    branching ||
    !!resumeTurn ||
    !!pendingRetry ||
    !!pendingBranch;
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
                            <p>
                              {char.role}
                              {c.branch && (
                                <span className="branch-list-label">
                                  <GitBranch size={11} />
                                  {branchLabels[c.branch.action]}
                                </span>
                              )}
                            </p>
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
                    <small>
                      오랜만에 접속했다면 연결까지 1분 정도 걸릴 수 있어요.
                    </small>
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
              {chat.branch && (
                <div className="branch-banner">
                  <span>
                    <GitBranch size={14} />
                    {branchLabels[chat.branch.action]}
                  </span>
                  <button
                    disabled={branching}
                    onClick={() =>
                      void openChat(current, chat.branch!.parent_id)
                    }
                  >
                    <ArrowLeft size={13} /> 이전 이야기
                  </button>
                </div>
              )}
              <div
                className="message-scroll"
                ref={messageScroll}
                onScroll={(event) => {
                  const node = event.currentTarget;
                  nearBottom.current =
                    node.scrollHeight - node.scrollTop - node.clientHeight < 96;
                  setShowLatest(!nearBottom.current);
                }}
              >
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
                    {(m.role === "assistant" || m.actions?.edit) && (
                      <div className="message-actions">
                        {m.actions?.regenerate &&
                          typeof m.action_cost === "number" &&
                          m.action_cost > 0 && (
                            <button
                              disabled={chatUnavailable}
                              onClick={() =>
                                chooseBranchAction(m, "regenerate")
                              }
                            >
                              <RefreshCw size={13} />
                              <span>다른 답변 · {m.action_cost} 빛</span>
                            </button>
                          )}
                        {m.actions?.branch && (
                          <button
                            disabled={chatUnavailable}
                            onClick={() => chooseBranchAction(m, "branch")}
                          >
                            <GitBranch size={13} />
                            <span>여기서 분기</span>
                          </button>
                        )}
                        {m.actions?.edit &&
                          typeof m.action_cost === "number" &&
                          m.action_cost > 0 && (
                            <button
                              disabled={chatUnavailable}
                              onClick={() => chooseBranchAction(m, "edit")}
                            >
                              <Pencil size={13} />
                              <span>수정해서 이어가기</span>
                            </button>
                          )}
                        {m.role === "assistant" && (
                          <button
                            aria-label="답변 의견 남기기"
                            onClick={() => setFeedback(m.id)}
                          >
                            <Flag size={13} />
                            <span>의견 남기기</span>
                          </button>
                        )}
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
                          <small>
                            {connection === "reconnecting"
                              ? "연결을 복구하고 있어요"
                              : replyPhase === "writing"
                                ? "답장을 쓰고 있어요"
                                : "답장을 생각하고 있어요"}
                          </small>
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div
                className="chat-progress"
                aria-live="polite"
                aria-atomic="true"
              >
                {showLatest && (
                  <button
                    className="latest-message-button"
                    onClick={jumpToLatest}
                  >
                    <ArrowDown size={14} /> 최신 대화 보기
                  </button>
                )}
                {sending && stream && connection === "reconnecting" && (
                  <span className="connection-note">
                    연결을 복구하고 있어요. 저장된 답변부터 이어 받아요.
                  </span>
                )}
                {branching && (
                  <span className="connection-note">
                    선택한 장면에서 새 이야기를 열고 있어요…
                  </span>
                )}
                {pendingBranch && !branching && (
                  <div className="reply-recovery">
                    <span>
                      {pendingBranch.result
                        ? "만들어진 새 이야기를 다시 열 수 있어요."
                        : "이야기 전환 결과를 확인해 주세요. 같은 요청으로 이어가요."}
                    </span>
                    <button
                      disabled={
                        busy || sending || !!resumeTurn || !!pendingRetry
                      }
                      onClick={() => void runBranchAction(pendingBranch)}
                    >
                      <RefreshCw size={14} /> 이야기 전환 확인
                    </button>
                  </div>
                )}
                {pendingRetry && !sending && !resumeTurn && !error && (
                  <div className="reply-recovery">
                    <span>
                      전송 결과를 확인하지 못했어요. 같은 메시지로 다시 확인해
                      주세요.
                    </span>
                    <button
                      onClick={() =>
                        void send(
                          pendingRetry.content,
                          pendingRetry.story_event,
                          true,
                        )
                      }
                    >
                      <RefreshCw size={14} /> 같은 메시지 재시도
                    </button>
                  </div>
                )}
                {resumeTurn && !sending && (
                  <div className="reply-recovery">
                    <span>
                      저장된 답변에 다시 연결할 수 있어요. 빛은 추가로 사용하지
                      않아요.
                    </span>
                    <button onClick={() => void reconnectReply()}>
                      <RefreshCw size={14} /> 답변 다시 연결
                    </button>
                  </div>
                )}
              </div>
              <div className="composer-wrap">
                {chat.messages.length === 1 && !sending && (
                  <div className="starters">
                    {current.starters.map((s) => (
                      <button
                        key={s}
                        disabled={chatUnavailable}
                        onClick={() => send(s)}
                      >
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
                    disabled={chatUnavailable}
                    onClick={() =>
                      send("주변에 새로운 단서가 있는지 살펴본다.", "discovery")
                    }
                  >
                    새로운 발견
                  </button>
                  <button
                    disabled={chatUnavailable}
                    onClick={() =>
                      send("함께 다른 장소로 걸어갈까?", "change_scene")
                    }
                  >
                    장소 바꾸기
                  </button>
                  <button
                    disabled={chatUnavailable}
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
                        disabled={chatUnavailable}
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
                      disabled={chatUnavailable || !draft.trim()}
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
                        disabled={chatUnavailable}
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
                            disabled={chatUnavailable}
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
                            disabled={chatUnavailable}
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
                          disabled={chatUnavailable}
                          onClick={async () => {
                            const cid = chat.id,
                              epoch = viewEpoch.current;
                            try {
                              await api(`/v1/conversations/${cid}/episodes`, {
                                method: "DELETE",
                              });
                              await refreshChat(cid, epoch);
                              if (!isChatView(cid, epoch)) return;
                              notify(
                                "이전 장면을 지웠어요. 별도로 저장한 기억 노트는 남아 있어요.",
                              );
                            } catch (e) {
                              if (isChatView(cid, epoch))
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
                        disabled={chatUnavailable}
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
                        disabled={chatUnavailable}
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
                        disabled={chatUnavailable}
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
              disabled={sending || !!resumeTurn}
              onClick={() =>
                send(pendingRetry.content, pendingRetry.story_event, true)
              }
            >
              <RefreshCw size={14} />
              같은 메시지 재시도
            </button>
          )}
          {!characters.length && (
            <button
              disabled={loading}
              onClick={() => void loadCatalog().then(loadMe)}
            >
              다시 불러오기
            </button>
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
      {branchDialog && chat && (
        <Modal
          error={error}
          title={branchLabels[branchDialog.action]}
          onClose={() => setBranchDialog(null)}
        >
          <form
            className="form-stack branch-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (chatUnavailable) return;
              void runBranchAction({
                body: {
                  client_id: crypto.randomUUID(),
                  message_id: branchDialog.message.id,
                  action: branchDialog.action,
                  ...(branchDialog.action === "edit"
                    ? { content: branchContent.trim() }
                    : {}),
                },
              });
            }}
          >
            <p className="modal-description">
              {branchDialog.action === "branch"
                ? "이 답변까지의 기억, 관계와 이야기 상태로 새 이야기를 시작해요."
                : branchDialog.action === "regenerate"
                  ? "이 답변 직전의 기억, 관계와 이야기 상태로 돌아가, 같은 메시지에 다른 답변을 받아요."
                  : "이 메시지를 보내기 직전의 기억, 관계와 이야기 상태로 돌아가, 수정한 내용으로 새 답변을 받아요."}{" "}
              선택한 시점 이후의 대화는 새 갈래에 포함되지 않아요. 원본 대화는
              그대로 남아요. 나중에 고치거나 지운 기억도 당시 상태로 돌아와요.
            </p>
            {branchDialog.action === "edit" ? (
              <label className="field">
                수정할 메시지
                <textarea
                  value={branchContent}
                  required
                  maxLength={3000}
                  onChange={(event) => setBranchContent(event.target.value)}
                />
                <small>{branchContent.length}/3000</small>
              </label>
            ) : (
              <blockquote className="branch-preview">
                {branchDialog.message.content.slice(0, 280)}
                {branchDialog.message.content.length > 280 ? "…" : ""}
              </blockquote>
            )}
            <div className="branch-cost">
              <span>
                <Sparkles size={15} />
                {branchDialog.action === "branch"
                  ? "분기는 무료예요"
                  : `새 답변 ${branchDialog.message.action_cost} 빛`}
              </span>
              {branchDialog.action !== "branch" && (
                <small>원래 대화 모드로 답변을 생성해요.</small>
              )}
            </div>
            <div className="branch-dialog-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setBranchDialog(null)}
              >
                돌아가기
              </button>
              <button
                className="primary"
                disabled={
                  chatUnavailable ||
                  (branchDialog.action === "edit" &&
                    (!branchContent.trim() ||
                      branchContent.trim() ===
                        branchDialog.message.content.trim()))
                }
              >
                <GitBranch size={16} />
                {branchDialog.action === "branch"
                  ? "새 갈래 시작하기"
                  : "새 갈래에서 답변 받기"}
              </button>
            </div>
          </form>
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
