import React, { useState, useEffect, useRef } from "react";
import { packagesFor, purchase, nativeBillingAvailable } from "./billing";
import type { PurchasesPackage } from "react-native-purchases";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  FlatList,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ActivityIndicator,
  Switch,
  AppState,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetch as streamFetch } from "expo/fetch";
import {
  createApi,
  ApiError,
  parseSseBlock,
  type Character,
  type Conversation,
  type ConversationSummary,
  type Message,
  type BranchAction,
  type BranchRequest,
  type BranchResult,
  type User,
  ko,
} from "@yeoun/contracts";
const base = process.env.EXPO_PUBLIC_API_URL || "http://127.0.0.1:8000";
const assetBase = process.env.EXPO_PUBLIC_ASSET_URL || "http://127.0.0.1:3000";
const api = createApi(base, () => SecureStore.getItemAsync("yeoun-token"));
type PendingMessage = {
  client_id: string;
  content: string;
  mode: "quick" | "story";
  story_event: string | null;
};
const actionLabels: Record<BranchAction, string> = {
  branch: "여기서 새 이야기",
  regenerate: "다른 답장 보기",
  edit: "내 메시지 수정",
};
const posters: Record<string, number> = {
  taeo: require("../web/public/characters/taeo.png"),
  eunho: require("../web/public/characters/eunho.png"),
  doyun: require("../web/public/characters/doyun.png"),
  yujun: require("../web/public/characters/yujun.png"),
  sihyeok: require("../web/public/characters/sihyeok.png"),
  igyeol: require("../web/public/characters/igyeol.png"),
  rohan: require("../web/public/characters/rohan.png"),
  siu: require("../web/public/characters/siu.png"),
  yuchan: require("../web/public/characters/yuchan.png"),
  astel: require("../web/public/characters/astel.png"),
  arin: require("../web/public/characters/arin.png"),
  nari: require("../web/public/characters/nari.png"),
  rina: require("../web/public/characters/rina.png"),
  jiwoo: require("../web/public/characters/jiwoo.png"),
  soyul: require("../web/public/characters/soyul.png"),
  elise: require("../web/public/characters/elise.png"),
  chaerin: require("../web/public/characters/chaerin.png"),
  rumi: require("../web/public/characters/rumi.png"),
  daeun: require("../web/public/characters/daeun.png"),
  serena: require("../web/public/characters/serena.png"),
  seah: require("../web/public/characters/seah.png"),
  sion: require("../web/public/characters/sion.png"),
  yura: require("../web/public/characters/yura.png"),
  jihan: require("../web/public/characters/jihan.png"),
  haru: require("../web/public/characters/haru.png"),
  dogeon: require("../web/public/characters/dogeon.png"),
  seoyun: require("../web/public/characters/seoyun.png"),
  kairen: require("../web/public/characters/kairen.png"),
  ian: require("../web/public/characters/ian.png"),
  doha: require("../web/public/characters/doha.png"),
};
function Portrait({ c, style }: { c: Character; style?: object }) {
  return c.image ? (
    <Image
      source={posters[c.id] || { uri: assetBase + c.image }}
      style={style}
    />
  ) : (
    <View
      style={[
        style,
        {
          backgroundColor: c.color,
          alignItems: "center",
          justifyContent: "center",
        },
      ]}
    >
      <Text style={{ color: "white" }}>✦ {c.name}</Text>
    </View>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <Experience />
    </SafeAreaProvider>
  );
}
function Experience() {
  const [gender, setGender] = useState("전체");
  const [artStyle, setArtStyle] = useState("전체");
  const [chars, setChars] = useState<Character[]>([]),
    [user, setUser] = useState<User | null>(null),
    [convs, setConvs] = useState<ConversationSummary[]>([]),
    [chat, setChat] = useState<Conversation | null>(null),
    [draft, setDraft] = useState(""),
    [query, setQuery] = useState(""),
    [genre, setGenre] = useState("전체");
  const [tab, setTab] = useState<"discover" | "chats">("discover"),
    [sheet, setSheet] = useState<"memory" | "account" | "wallet" | null>(null),
    [sending, setSending] = useState(false),
    [stream, setStream] = useState(""),
    [error, setError] = useState(""),
    [demo, setDemo] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [nickname, setNickname] = useState("여행자"),
    [register, setRegister] = useState(false),
    [mode, setMode] = useState<"quick" | "story">("quick"),
    [memoryKey, setMemoryKey] = useState(""),
    [memoryValue, setMemoryValue] = useState("");
  const ctrl = useRef<AbortController | null>(null),
    chatRef = useRef<Conversation | null>(null),
    chatGeneration = useRef(0),
    activeConversation = useRef<string | null>(null),
    reloadSequence = useRef(0),
    scroll = useRef<React.ElementRef<typeof ScrollView>>(null),
    nearBottom = useRef(true),
    draftRef = useRef(""),
    draftHydrated = useRef(false),
    draftRevision = useRef(0),
    draftWrites = useRef(Promise.resolve()),
    pendingWrites = useRef(Promise.resolve()),
    lock = useRef(false),
    draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showLatest, setShowLatest] = useState(false),
    [replyPhase, setReplyPhase] = useState<
      "thinking" | "writing" | "reconnecting" | "paused" | null
    >(null),
    [resumeTurn, setResumeTurn] = useState<{
      conversationId: string;
      turnId: string;
    } | null>(null);
  const pending = useRef<PendingMessage | null>(null);
  const pendingAction = useRef<BranchRequest | null>(null);
  const [actionDialog, setActionDialog] = useState<{
    conversationId: string;
    generation: number;
    message: Message;
    action: BranchAction;
  } | null>(null);
  const [actionContent, setActionContent] = useState("");
  const [actionSending, setActionSending] = useState(false);
  const [storePackages, setStorePackages] = useState<PurchasesPackage[]>([]),
    [purchasing, setPurchasing] = useState(false),
    [paymentNotice, setPaymentNotice] = useState("");
  useEffect(() => {
    if (sheet === "wallet" && user?.email && nativeBillingAvailable)
      packagesFor(user.id)
        .then(setStorePackages)
        .catch((e) => setError(e.message));
  }, [sheet, user?.id, user?.email]);
  async function buy(item: PurchasesPackage) {
    if (purchasing || !user) return;
    setPurchasing(true);
    setError("");
    try {
      if (!(await purchase(item))) return;
      setPaymentNotice(
        "승인을 확인하고 있어요. 화면을 닫아도 충전은 이어집니다.",
      );
      const before = user.credits;
      for (let i = 0; i < 8; i++) {
        const updated = await refreshUser();
        if (updated.credits !== before) {
          setPaymentNotice("충전했어요. 이전 대화를 이어가세요.");
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      setPaymentNotice(
        "스토어 승인을 기다리고 있어요. 잠시 후 잔액을 확인해 주세요. 같은 상품을 다시 결제할 필요는 없어요.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPurchasing(false);
    }
  }
  const char = chars.find((c) => c.id === chat?.character_id);
  const chatBusy =
    sending ||
    actionSending ||
    resumeTurn !== null ||
    pending.current !== null ||
    pendingAction.current !== null ||
    !!chat?.active_turn;
  const phaseLabel =
    replyPhase === "reconnecting"
      ? "연결을 다시 확인하고 있어요…"
      : replyPhase === "paused"
        ? "저장된 답변을 다시 불러와 주세요."
        : replyPhase === "writing"
          ? "답장을 쓰고 있어요…"
          : "답장을 생각하고 있어요…";
  async function refreshUser() {
    const u = await api<User>("/v1/me");
    setUser(u);
    setConvs(await api<ConversationSummary[]>("/v1/conversations"));
    return u;
  }
  async function ensure() {
    try {
      return await refreshUser();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      const res = await api<{ user: User; token: string }>("/v1/auth/guest", {
        method: "POST",
        body: JSON.stringify({ native: true }),
      });
      if (res.token) await SecureStore.setItemAsync("yeoun-token", res.token);
      setUser(res.user);
      return res.user;
    }
  }
  function isCurrentChat(cid: string, generation: number) {
    return (
      chatGeneration.current === generation &&
      activeConversation.current === cid
    );
  }
  async function reload(cid: string, generation = chatGeneration.current) {
    if (!isCurrentChat(cid, generation)) return null;
    const sequence = ++reloadSequence.current;
    const c = await api<Conversation>(`/v1/conversations/${cid}`);
    if (!isCurrentChat(cid, generation) || sequence !== reloadSequence.current)
      return null;
    setChat(c);
    chatRef.current = c;
    void refreshUser().catch(() => {});
    return c;
  }
  function persistDraft(cid: string, value: string | null) {
    draftWrites.current = draftWrites.current
      .catch(() => {})
      .then(() =>
        value === null
          ? AsyncStorage.removeItem("draft:" + cid)
          : AsyncStorage.setItem("draft:" + cid, value),
      );
    // Storage failures must not interrupt a message that has already been sent.
    void draftWrites.current.catch(() => {});
  }
  function savePending(cid: string, body: PendingMessage) {
    pendingWrites.current = pendingWrites.current
      .catch(() => {})
      .then(() =>
        AsyncStorage.setItem("pending-turn:" + cid, JSON.stringify(body)),
      );
    return pendingWrites.current;
  }
  function clearPending(cid: string, clientId: string) {
    pendingWrites.current = pendingWrites.current
      .catch(() => {})
      .then(async () => {
        const stored = await AsyncStorage.getItem("pending-turn:" + cid);
        if (stored && JSON.parse(stored).client_id === clientId)
          await AsyncStorage.removeItem("pending-turn:" + cid);
      });
    return pendingWrites.current;
  }
  async function loadPending(cid: string): Promise<PendingMessage | null> {
    await pendingWrites.current.catch(() => {});
    const stored = await AsyncStorage.getItem("pending-turn:" + cid);
    if (!stored) return null;
    const value = JSON.parse(stored) as PendingMessage;
    if (
      typeof value.client_id !== "string" ||
      typeof value.content !== "string" ||
      !["quick", "story"].includes(value.mode) ||
      !(value.story_event === null || typeof value.story_event === "string")
    )
      throw new Error(
        "이전 전송 정보를 불러오지 못했어요. 앱을 다시 열어 주세요.",
      );
    return value;
  }
  function savePendingAction(cid: string, body: BranchRequest) {
    pendingWrites.current = pendingWrites.current
      .catch(() => {})
      .then(() =>
        AsyncStorage.setItem("pending-action:" + cid, JSON.stringify(body)),
      );
    return pendingWrites.current;
  }
  function clearPendingAction(cid: string, clientId: string) {
    pendingWrites.current = pendingWrites.current
      .catch(() => {})
      .then(async () => {
        const stored = await AsyncStorage.getItem("pending-action:" + cid);
        if (stored && JSON.parse(stored).client_id === clientId)
          await AsyncStorage.removeItem("pending-action:" + cid);
      });
    return pendingWrites.current;
  }
  async function loadPendingAction(cid: string): Promise<BranchRequest | null> {
    await pendingWrites.current.catch(() => {});
    const stored = await AsyncStorage.getItem("pending-action:" + cid);
    if (!stored) return null;
    const value = JSON.parse(stored) as BranchRequest;
    if (
      typeof value.client_id !== "string" ||
      typeof value.message_id !== "string" ||
      !["branch", "regenerate", "edit"].includes(value.action) ||
      (value.action === "edit" && typeof value.content !== "string")
    )
      throw new Error(
        "이전 이야기 요청을 불러오지 못했어요. 앱을 다시 열어 주세요.",
      );
    return value;
  }
  function flushDraft() {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    if (activeConversation.current && draftHydrated.current)
      persistDraft(activeConversation.current, draftRef.current);
  }
  function resetChatView() {
    flushDraft();
    chatGeneration.current += 1;
    ctrl.current?.abort();
    ctrl.current = null;
    activeConversation.current = null;
    chatRef.current = null;
    pending.current = null;
    pendingAction.current = null;
    lock.current = false;
    nearBottom.current = true;
    draftRef.current = "";
    draftHydrated.current = false;
    draftRevision.current += 1;
    setChat(null);
    setDraft("");
    setMemoryKey("");
    setMemoryValue("");
    setActionDialog(null);
    setActionContent("");
    setActionSending(false);
    setSending(false);
    setStream("");
    setReplyPhase(null);
    setResumeTurn(null);
    setShowLatest(false);
    setError("");
    setSheet(null);
    return chatGeneration.current;
  }
  function jumpToLatest(animated = true) {
    nearBottom.current = true;
    setShowLatest(false);
    scroll.current?.scrollToEnd({ animated });
  }
  useEffect(() => {
    Promise.all([
      api<Character[]>("/v1/characters"),
      api<{ mode: string }>("/health"),
    ])
      .then(([cs, h]) => {
        setChars(cs);
        setDemo(h.mode === "demo");
      })
      .catch((e) => setError(e.message));
    refreshUser().catch(() => {});
    return () => {
      chatGeneration.current += 1;
      ctrl.current?.abort();
      flushDraft();
    };
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (state) => {
      if (state === "active" && chatRef.current) {
        const cid = chatRef.current.id;
        const generation = chatGeneration.current;
        try {
          const c = await reload(cid, generation);
          if (c?.active_turn && !pending.current && !pendingAction.current)
            void follow(c.id, c.active_turn, generation);
        } catch (e) {
          if (isCurrentChat(cid, generation)) setError((e as Error).message);
        }
      }
    });
    return () => sub.remove();
  }, []);
  async function follow(
    cid: string,
    tid: string,
    generation = chatGeneration.current,
  ) {
    if (!isCurrentChat(cid, generation)) return;
    ctrl.current?.abort();
    const abort = new AbortController();
    ctrl.current = abort;
    const current = () =>
      isCurrentChat(cid, generation) &&
      ctrl.current === abort &&
      !abort.signal.aborted;
    lock.current = true;
    setSending(true);
    setStream("");
    setError("");
    setReplyPhase("thinking");
    setResumeTurn({ conversationId: cid, turnId: tid });
    let cursor = 0,
      terminal: "done" | "failed" | null = null,
      restored = false;
    try {
      for (let attempt = 0; attempt < 8 && !terminal; attempt++) {
        if (!current()) return;
        if (attempt > 0) setReplyPhase("reconnecting");
        try {
          const token = await SecureStore.getItemAsync("yeoun-token");
          if (!current()) return;
          const res = await streamFetch(
            `${base}/v1/turns/${tid}/events?after=${cursor}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: abort.signal,
            },
          );
          if (!res.ok || !res.body)
            throw new Error("답변 연결을 확인해 주세요.");
          if (!current()) return;
          const reader = res.body.getReader(),
            decoder = new TextDecoder();
          let buffer = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (!current()) return;
              buffer += decoder.decode(value, { stream: !done });
              let end;
              while ((end = buffer.indexOf("\n\n")) >= 0) {
                const item = parseSseBlock(buffer.slice(0, end));
                buffer = buffer.slice(end + 2);
                if (item && item.id > cursor) {
                  cursor = item.id;
                  if (item.event === "phase") {
                    const name = item.data.name;
                    if (name === "thinking" || name === "writing")
                      setReplyPhase(name);
                  }
                  if (item.event === "delta") {
                    setReplyPhase("writing");
                    setStream((s) => s + String(item.data.text));
                  }
                  if (item.event === "failed") {
                    setStream("");
                    setError(String(item.data.message));
                  }
                  if (item.event === "done" || item.event === "failed")
                    terminal = item.event;
                }
              }
              if (done || terminal) break;
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
        } catch (e) {
          if (!current()) return;
        }
        if (!terminal && attempt < 7) {
          setReplyPhase("reconnecting");
          await new Promise((r) =>
            setTimeout(r, Math.min(500 * 2 ** attempt, 4000)),
          );
        }
      }
      if (!current()) return;
      // The server may have committed a reply even if its terminal event was lost.
      const saved = await reload(cid, generation);
      if (!current()) return;
      if (!terminal && saved) {
        if (
          saved.messages.some(
            (m) => m.turn_id === tid && m.role === "assistant",
          )
        )
          terminal = "done";
        else if (
          saved.messages.some((m) => m.turn_id === tid && m.status === "failed")
        ) {
          terminal = "failed";
          setError("답변을 완성하지 못했어요. 사용한 빛은 돌려드렸어요.");
        }
      }
      if (!terminal || !saved)
        throw new Error(
          "연결이 끊겼어요. 저장된 답변을 다시 불러올 수 있어요.",
        );
      restored = true;
      setResumeTurn(null);
      if (terminal === "done")
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      if (current()) {
        ctrl.current = null;
        setSending(false);
        setReplyPhase(restored ? null : "paused");
        if (restored) setStream("");
        lock.current = !restored;
      }
    }
  }
  async function open(c: Character, id?: string, preloaded?: Conversation) {
    const generation = resetChatView();
    const openingDraftRevision = draftRevision.current;
    try {
      if (!preloaded) await ensure();
      if (generation !== chatGeneration.current) return;
      const cid =
        id ||
        convs.find((x) => x.character_id === c.id)?.id ||
        (
          await api<{ id: string }>("/v1/conversations", {
            method: "POST",
            body: JSON.stringify({ character_id: c.id }),
          })
        ).id;
      if (generation !== chatGeneration.current) return;
      activeConversation.current = cid;
      const storedPending = await loadPending(cid);
      const storedAction = await loadPendingAction(cid);
      if (!isCurrentChat(cid, generation)) return;
      pending.current = storedPending;
      pendingAction.current = storedAction;
      const data = preloaded || (await reload(cid, generation));
      if (!data || !isCurrentChat(cid, generation)) return;
      if (preloaded) {
        chatRef.current = data;
        setChat(data);
        void refreshUser().catch(() => {});
      }
      if (data.active_turn && !storedPending && !storedAction)
        void follow(cid, data.active_turn, generation);
      await draftWrites.current.catch(() => {});
      const savedDraft = await AsyncStorage.getItem("draft:" + cid).catch(
        () => undefined,
      );
      if (!isCurrentChat(cid, generation)) return;
      if (
        savedDraft !== undefined &&
        openingDraftRevision === draftRevision.current
      ) {
        draftRef.current = savedDraft || "";
        draftHydrated.current = true;
        setDraft(savedDraft || "");
      }
    } catch (e) {
      if (generation === chatGeneration.current) setError((e as Error).message);
    }
  }
  async function send(
    text = draft,
    event: string | null = null,
    retry = false,
  ) {
    const currentChat = chatRef.current;
    if (!currentChat || !text.trim() || lock.current || pendingAction.current)
      return;
    if (pending.current && !retry) return;
    const cid = currentChat.id;
    const generation = chatGeneration.current;
    const sentDraftRevision = draftRevision.current;
    const consumesDraft = text === draftRef.current;
    lock.current = true;
    setSending(true);
    setError("");
    setReplyPhase("thinking");
    jumpToLatest();
    const body =
      retry && pending.current
        ? pending.current
        : {
            client_id: Crypto.randomUUID(),
            content: text,
            mode,
            story_event: event,
          };
    pending.current = body;
    try {
      // Persist the idempotency key before dispatch, including app restarts.
      await savePending(cid, body);
      const turn = await api<{ id: string }>(`/v1/conversations/${cid}/turns`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      // Receipts belong to the request, even if its chat has since been closed.
      await clearPending(cid, body.client_id);
      if (!isCurrentChat(cid, generation)) return;
      pending.current = null;
      setResumeTurn({ conversationId: cid, turnId: turn.id });
      if (consumesDraft && sentDraftRevision === draftRevision.current) {
        if (draftTimer.current) clearTimeout(draftTimer.current);
        draftTimer.current = null;
        draftRef.current = "";
        draftHydrated.current = true;
        draftRevision.current += 1;
        setDraft("");
        persistDraft(cid, null);
      }
      const saved = await reload(cid, generation).catch(() => null);
      if (!isCurrentChat(cid, generation)) return;
      const replyAlreadySaved = saved?.messages.some(
        (m) => m.turn_id === turn.id && m.role === "assistant",
      );
      const failedAlreadySaved = saved?.messages.some(
        (m) => m.turn_id === turn.id && m.status === "failed",
      );
      if (replyAlreadySaved || failedAlreadySaved) {
        setResumeTurn(null);
        setSending(false);
        setStream("");
        setReplyPhase(null);
        lock.current = false;
        if (failedAlreadySaved)
          setError("답변을 완성하지 못했어요. 사용한 빛은 돌려드렸어요.");
      } else await follow(cid, turn.id, generation);
    } catch (e) {
      const rejected =
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 408;
      if (rejected) await clearPending(cid, body.client_id).catch(() => {});
      if (!isCurrentChat(cid, generation)) return;
      if (rejected) pending.current = null;
      setError((e as Error).message);
      setSending(false);
      setReplyPhase(null);
      lock.current = false;
    }
  }
  function chooseAction(message: Message, action: BranchAction) {
    const currentChat = chatRef.current;
    if (
      !currentChat ||
      lock.current ||
      chatBusy ||
      !message.actions?.[action] ||
      (action !== "branch" && !(Number(message.action_cost) > 0))
    )
      return;
    setError("");
    setActionContent(action === "edit" ? message.content : "");
    setActionDialog({
      conversationId: currentChat.id,
      generation: chatGeneration.current,
      message,
      action,
    });
  }
  async function confirmAction(retry = false) {
    const source = chatRef.current;
    if (!source || lock.current || pending.current) return;
    const cid = source.id;
    const generation = chatGeneration.current;
    const selected = actionDialog;
    let body: BranchRequest;
    if (retry && pendingAction.current) body = pendingAction.current;
    else {
      if (
        pendingAction.current ||
        source.active_turn ||
        !selected ||
        selected.conversationId !== cid ||
        selected.generation !== generation ||
        !source.messages.find((m) => m.id === selected.message.id)?.actions?.[
          selected.action
        ] ||
        (selected.action === "edit" && !actionContent.trim())
      )
        return;
      body = {
        client_id: Crypto.randomUUID(),
        message_id: selected.message.id,
        action: selected.action,
        ...(selected.action === "edit" ? { content: actionContent } : {}),
      };
    }
    const character = chars.find((c) => c.id === source.character_id);
    if (!character) return;
    lock.current = true;
    pendingAction.current = body;
    setActionSending(true);
    setActionDialog(null);
    setError("");
    let accepted = false;
    try {
      await savePendingAction(cid, body);
      const result = await api<BranchResult>(
        `/v1/conversations/${cid}/branches`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      accepted = true;
      if (!isCurrentChat(cid, generation)) {
        await clearPendingAction(cid, body.client_id);
        void refreshUser().catch(() => {});
        return;
      }
      // Keep the idempotent request until the new conversation can be opened.
      const target = await api<Conversation>(
        `/v1/conversations/${result.conversation_id}`,
      );
      await clearPendingAction(cid, body.client_id);
      if (!isCurrentChat(cid, generation)) return;
      pendingAction.current = null;
      await open(character, target.id, target);
    } catch (e) {
      const rejected =
        !accepted &&
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 408;
      if (rejected)
        await clearPendingAction(cid, body.client_id).catch(() => {});
      if (!isCurrentChat(cid, generation)) return;
      if (rejected) {
        pendingAction.current = null;
        if (selected) {
          setActionDialog(selected);
          setActionContent(body.content || "");
        }
      }
      setError((e as Error).message);
    } finally {
      if (isCurrentChat(cid, generation)) {
        lock.current = false;
        setActionSending(false);
      }
    }
  }
  function close() {
    resetChatView();
    refreshUser().catch(() => {});
  }
  function changeDraft(s: string) {
    draftRef.current = s;
    draftHydrated.current = true;
    draftRevision.current += 1;
    setDraft(s);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const cid = activeConversation.current;
    if (cid) draftTimer.current = setTimeout(() => persistDraft(cid, s), 150);
  }
  async function auth() {
    setError("");
    try {
      const r = await api<{ user: User; token: string }>(
        `/v1/auth/${register ? "register" : "login"}`,
        {
          method: "POST",
          body: JSON.stringify({ email, password, nickname, native: true }),
        },
      );
      await SecureStore.setItemAsync("yeoun-token", r.token);
      setUser(r.user);
      await refreshUser();
      setChars(await api<Character[]>("/v1/characters"));
      setPassword("");
      setSheet(null);
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveMemory() {
    if (!chat) return;
    const cid = chat.id;
    const generation = chatGeneration.current;
    try {
      await api(`/v1/conversations/${cid}/memories`, {
        method: "POST",
        body: JSON.stringify({ key: memoryKey, value: memoryValue }),
      });
      await reload(cid, generation);
      if (!isCurrentChat(cid, generation)) return;
      setMemoryKey("");
      setMemoryValue("");
    } catch (e) {
      if (isCurrentChat(cid, generation)) setError((e as Error).message);
    }
  }
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="light" />
      {chat && char ? (
        <KeyboardAvoidingView
          style={s.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={s.header}>
            <Pressable accessibilityLabel="대화 나가기" onPress={close}>
              <Text style={s.back}>‹</Text>
            </Pressable>
            <Portrait c={char} style={s.avatar} />
            <View style={s.fill}>
              <Text style={s.chatName}>
                {char.name} <Text style={s.small}>AI</Text>
              </Text>
              <Text style={s.small}>
                {chat.relationship.stage} · 제 {chat.narrative.chapter}장
              </Text>
            </View>
            <Pressable onPress={() => setSheet("memory")}>
              <Text style={s.link}>기억 노트</Text>
            </Pressable>
          </View>
          {demo && <Text style={s.demo}>로컬 체험 모드 · 예시 답변입니다</Text>}
          {chat.branch && (
            <View style={s.branchBanner}>
              <Text style={s.small}>↳ 원본에서 이어진 새로운 이야기</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => open(char, chat.branch!.parent_id)}
              >
                <Text style={s.link}>원본 대화 보기</Text>
              </Pressable>
            </View>
          )}
          <ScrollView
            ref={scroll}
            style={s.fill}
            contentContainerStyle={s.messages}
            scrollEventThrottle={16}
            onScroll={({ nativeEvent }) => {
              const atBottom =
                nativeEvent.contentSize.height -
                  nativeEvent.layoutMeasurement.height -
                  nativeEvent.contentOffset.y <
                80;
              nearBottom.current = atBottom;
              setShowLatest(!atBottom);
            }}
            onLayout={() => {
              if (nearBottom.current) jumpToLatest(false);
            }}
            onContentSizeChange={() => {
              if (nearBottom.current) jumpToLatest(false);
              else setShowLatest(true);
            }}
          >
            <Text style={s.scene}>{char.description}</Text>
            {chat.messages.map((m) => (
              <View
                key={m.id}
                style={[
                  s.message,
                  m.role === "user" ? s.userMessage : s.assistantMessage,
                ]}
              >
                {m.role === "assistant" && (
                  <Text style={s.author}>{char.name}</Text>
                )}
                <Text style={s.messageText}>{m.content}</Text>
                {m.status === "failed" && (
                  <Text style={s.error}>답변 실패 · 빛 환급</Text>
                )}
                {m.actions && (
                  <View style={s.messageActions}>
                    {(["branch", "regenerate", "edit"] as const)
                      .filter(
                        (action) =>
                          m.actions?.[action] &&
                          (action === "branch" || Number(m.action_cost) > 0),
                      )
                      .map((action) => (
                        <Pressable
                          key={action}
                          accessibilityRole="button"
                          disabled={chatBusy}
                          style={[s.messageAction, chatBusy && s.disabled]}
                          onPress={() => chooseAction(m, action)}
                        >
                          <Text style={s.messageActionText}>
                            {actionLabels[action]} ·{" "}
                            {action === "branch"
                              ? "무료"
                              : `${m.action_cost} 빛`}
                          </Text>
                        </Pressable>
                      ))}
                  </View>
                )}
              </View>
            ))}
            {(sending || resumeTurn) && (
              <View style={[s.message, s.assistantMessage]}>
                <Text style={s.author}>{char.name}</Text>
                <Text style={s.messageText}>{stream || phaseLabel}</Text>
                {!!stream &&
                  (replyPhase === "reconnecting" ||
                    replyPhase === "paused") && (
                    <Text
                      accessibilityLiveRegion="polite"
                      style={s.replyStatus}
                    >
                      {phaseLabel}
                    </Text>
                  )}
              </View>
            )}
          </ScrollView>
          {showLatest && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="최근 대화로 이동"
              onPress={() => jumpToLatest()}
              style={s.latestButton}
            >
              <Text style={s.latestLabel}>최근 대화 ↓</Text>
            </Pressable>
          )}
          <View style={s.composerWrap}>
            {actionSending && (
              <View style={s.branchProgress}>
                <ActivityIndicator color="#ff8aa0" size="small" />
                <Text style={s.small}>새 이야기를 준비하고 있어요…</Text>
              </View>
            )}
            {pendingAction.current && !actionSending && (
              <View style={s.resumeNotice}>
                <Text style={s.small}>
                  이야기 요청의 결과를 확인하지 못했어요. 같은 요청을 확인하며
                  빛을 중복으로 사용하지 않아요.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => confirmAction(true)}
                >
                  <Text style={s.link}>요청한 이야기 다시 열기</Text>
                </Pressable>
              </View>
            )}
            {pending.current && !sending && (
              <View style={s.resumeNotice}>
                <Text style={s.small}>
                  전송 결과를 확인하지 못했어요. 같은 메시지를 안전하게
                  재시도해요.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    const retry = pending.current;
                    if (retry)
                      void send(retry.content, retry.story_event, true);
                  }}
                >
                  <Text style={s.link}>같은 메시지 재시도</Text>
                </Pressable>
              </View>
            )}
            {resumeTurn && !sending && (
              <View style={s.resumeNotice}>
                <Text style={s.small}>
                  같은 답변을 불러와요. 빛은 추가로 사용하지 않아요.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    follow(resumeTurn.conversationId, resumeTurn.turnId)
                  }
                >
                  <Text style={s.link}>저장된 답변 다시 연결</Text>
                </Pressable>
              </View>
            )}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.chips}
            >
              {(chat.messages.length === 1 ? char.starters : []).map((t) => (
                <Pressable
                  disabled={chatBusy}
                  key={t}
                  style={s.chip}
                  onPress={() => send(t)}
                >
                  <Text style={s.chipText}>{t}</Text>
                </Pressable>
              ))}
              <Pressable
                disabled={chatBusy}
                style={s.chip}
                onPress={() =>
                  send("주변의 새로운 단서를 찾아본다.", "discovery")
                }
              >
                <Text style={s.chipText}>✧ 새로운 발견</Text>
              </Pressable>
              <Pressable
                disabled={chatBusy}
                style={s.chip}
                onPress={() => send("같이 잠깐 쉬자.", "quiet")}
              >
                <Text style={s.chipText}>잠시 쉬어가기</Text>
              </Pressable>
            </ScrollView>
            <View style={s.composer}>
              <TextInput
                accessibilityLabel="메시지"
                placeholder={`${char.name}에게 하고 싶은 말…`}
                placeholderTextColor="#9294a2"
                value={draft}
                onChangeText={changeDraft}
                multiline
                maxLength={3000}
                style={s.messageInput}
              />
              <View style={s.composerFooter}>
                <Pressable
                  disabled={chatBusy}
                  onPress={() => setMode(mode === "quick" ? "story" : "quick")}
                >
                  <Text style={s.small}>
                    ✦{" "}
                    {mode === "quick"
                      ? "짧은 대화 · 1 빛"
                      : "깊은 이야기 · 3 빛"}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={chatBusy || !draft.trim()}
                  accessibilityLabel="메시지 보내기"
                  style={[s.send, chatBusy && s.disabled]}
                  onPress={() => send()}
                >
                  {sending ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <Text style={s.sendText}>↑</Text>
                  )}
                </Pressable>
              </View>
            </View>
            <Text style={s.disclaimer}>{ko.aiNotice}</Text>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <>
          <View style={s.header}>
            <View style={s.brand} accessibilityLabel="테일비">
              <Image
                source={require("../web/public/brand/talevi-icon-192.png")}
                style={s.brandIcon}
              />
              <Text style={s.logo}>
                talevi<Text style={s.logoDot}>.</Text>
              </Text>
            </View>
            <View style={s.fill} />
            <Pressable onPress={() => setSheet("wallet")}>
              <Text style={s.link}>✧ {user?.credits ?? 30}</Text>
            </Pressable>
            <Pressable onPress={() => setSheet("account")}>
              <Text style={s.link}>내 계정</Text>
            </Pressable>
          </View>
          {demo && (
            <Text style={s.demo}>로컬 체험 모드 · 예시 답변과 테스트 결제</Text>
          )}
          {tab === "discover" ? (
            <FlatList
              data={chars.filter(
                (c) =>
                  (genre === "전체" || c.genre === genre) &&
                  (gender === "전체" || c.gender === gender) &&
                  (artStyle === "전체" || c.art_style === artStyle) &&
                  `${c.name} ${c.role} ${c.tags.join(" ")}`.includes(query),
              )}
              numColumns={2}
              columnWrapperStyle={s.gridRow}
              contentContainerStyle={s.catalog}
              keyExtractor={(c) => c.id}
              ListHeaderComponent={
                <>
                  <Text style={s.eyebrow}>TALEVI ORIGINALS</Text>
                  <Text style={s.title}>취향이 되는 첫 대화</Text>
                  <Text style={s.subtitle}>
                    마음에 드는 얼굴, 궁금해지는 이야기.
                  </Text>
                  {chars[0] &&
                    !query &&
                    gender === "전체" &&
                    artStyle === "전체" && (
                      <Pressable
                        accessibilityLabel={`${chars[0].name} 추천 이야기 시작`}
                        style={s.hero}
                        onPress={() => open(chars[0])}
                      >
                        <Portrait c={chars[0]} style={s.heroImage} />
                        <View style={s.heroCopy}>
                          <Text style={s.heroLabel}>
                            오늘의 만남 / {chars[0].art_style}
                          </Text>
                          <Text style={s.heroTitle}>{chars[0].headline}</Text>
                          <Text style={s.heroLink}>
                            {chars[0].name} 만나보기 →
                          </Text>
                        </View>
                      </Pressable>
                    )}
                  <TextInput
                    accessibilityLabel="캐릭터 검색"
                    style={s.search}
                    placeholder="캐릭터, 취향, 이야기를 검색하세요"
                    placeholderTextColor="#9294a2"
                    value={query}
                    onChangeText={setQuery}
                  />
                  <View style={s.genderTabs}>
                    {["전체", "여성", "남성"].map((g) => (
                      <Pressable
                        key={g}
                        accessibilityRole="button"
                        accessibilityState={{ selected: gender === g }}
                        style={[s.genderTab, gender === g && s.genderSelected]}
                        onPress={() => setGender(g)}
                      >
                        <Text style={[s.chipText, gender === g && s.white]}>
                          {g === "전체" ? "모든 캐릭터" : `${g} 캐릭터`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={s.styleSwitch}>
                    {["전체", "애니메이션", "반실사"].map((t) => (
                      <Pressable
                        key={t}
                        accessibilityRole="button"
                        accessibilityState={{ selected: artStyle === t }}
                        style={[
                          s.styleOption,
                          artStyle === t && s.styleSelected,
                        ]}
                        onPress={() => setArtStyle(t)}
                      >
                        <Text style={[s.chipText, artStyle === t && s.white]}>
                          {t === "전체" ? "모든 그림체" : t}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={s.chips}
                  >
                    {[
                      "전체",
                      "힐링",
                      "로맨스",
                      "일상",
                      "판타지",
                      "미스터리",
                    ].map((g) => (
                      <Pressable
                        key={g}
                        onPress={() => setGenre(g)}
                        style={[s.chip, g === genre && s.selected]}
                      >
                        <Text style={[s.chipText, g === genre && s.white]}>
                          {g}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              }
              renderItem={({ item: c }) => (
                <Pressable
                  style={s.card}
                  onPress={() => open(c)}
                  accessibilityLabel={`${c.name} 대화 시작`}
                >
                  <View>
                    <Portrait c={c} style={s.poster} />
                    <Text style={s.artBadge}>{c.art_style}</Text>
                  </View>
                  <Text style={s.cardName}>
                    {c.name} <Text style={s.small}>{c.age}</Text>
                  </Text>
                  <Text style={s.cardRole} numberOfLines={2}>
                    {c.headline.replace("\n", " ")}
                  </Text>
                  <Text style={s.cardTag} numberOfLines={1}>
                    {c.tags.map((t) => `#${t}`).join(" ")}
                  </Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={s.scene}>
                  {chars.length
                    ? "조건에 맞는 캐릭터가 없어요. 다른 성별이나 그림체를 선택해 주세요."
                    : "캐릭터를 불러오고 있어요."}
                </Text>
              }
            />
          ) : (
            <ScrollView contentContainerStyle={s.catalog}>
              <Text style={s.title}>아직 끝나지 않은 이야기</Text>
              {convs.map((c) => {
                const character = chars.find((x) => x.id === c.character_id);
                return character ? (
                  <Pressable
                    key={c.id}
                    style={s.chatRow}
                    onPress={() => open(character, c.id)}
                  >
                    <Portrait c={character} style={s.rowAvatar} />
                    <View style={s.fill}>
                      <Text style={s.cardName}>{character.name}</Text>
                      <Text style={s.small}>{c.relationship.stage}</Text>
                      {c.branch && (
                        <Text style={s.branchLabel}>
                          ↳{" "}
                          {c.branch.action === "regenerate"
                            ? "다른 답장으로 이어진 이야기"
                            : c.branch.action === "edit"
                              ? "수정한 말에서 이어진 이야기"
                              : "새롭게 나눈 이야기"}
                        </Text>
                      )}
                    </View>
                    <Text style={s.back}>›</Text>
                  </Pressable>
                ) : null;
              })}
              {!convs.length && (
                <Text style={s.scene}>첫 번째 인연에게 말을 걸어보세요.</Text>
              )}
            </ScrollView>
          )}
          <View style={s.bottomNav}>
            <Pressable onPress={() => setTab("discover")}>
              <Text style={[s.navText, tab === "discover" && s.active]}>
                ✧ 발견
              </Text>
            </Pressable>
            <Pressable onPress={() => setTab("chats")}>
              <Text style={[s.navText, tab === "chats" && s.active]}>
                ♡ 나의 대화
              </Text>
            </Pressable>
            <Pressable onPress={() => setSheet("account")}>
              <Text style={s.navText}>내 계정</Text>
            </Pressable>
          </View>
        </>
      )}
      {error && (
        <View style={s.errorBar}>
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
          <Pressable onPress={() => setError("")}>
            <Text style={s.link}>닫기</Text>
          </Pressable>
        </View>
      )}
      <Modal
        visible={actionDialog !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setActionDialog(null)}
      >
        <SafeAreaView style={s.safe}>
          <View style={s.header}>
            <Text style={s.chatName}>
              {actionDialog ? actionLabels[actionDialog.action] : "이야기 선택"}
            </Text>
            <View style={s.fill} />
            <Pressable onPress={() => setActionDialog(null)}>
              <Text style={s.link}>취소</Text>
            </Pressable>
          </View>
          {actionDialog && (
            <ScrollView
              contentContainerStyle={s.sheet}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
            >
              <Text style={s.title}>원본 대화는 그대로 남아요</Text>
              <Text style={s.subtitle}>
                {actionDialog.action === "branch"
                  ? "선택한 답장 직후의 기억, 관계와 이야기 상태에서 새 이야기를 시작해요. 이후 대화는 새 이야기에 포함하지 않아요."
                  : actionDialog.action === "edit"
                    ? "이 메시지를 보내기 전의 기억, 관계와 이야기 상태로 돌아가 수정한 말에 대한 답장을 받아요. 그 뒤의 대화는 새 이야기에 포함하지 않아요."
                    : "선택한 답장이 만들어지기 전의 기억, 관계와 이야기 상태로 돌아가 다른 답장을 받아요. 그 뒤의 대화는 새 이야기에 포함하지 않아요."}{" "}
                나중에 고치거나 지운 기억도 당시 상태로 돌아와요.
              </Text>
              <View style={s.memory}>
                <Text style={s.author}>선택한 메시지</Text>
                <Text style={s.messageText} numberOfLines={6}>
                  {actionDialog.message.content}
                </Text>
              </View>
              {actionDialog.action === "edit" && (
                <>
                  <Text style={s.author}>새 이야기에서 보낼 말</Text>
                  <TextInput
                    accessibilityLabel="수정할 메시지"
                    value={actionContent}
                    onChangeText={setActionContent}
                    multiline
                    maxLength={3000}
                    style={[s.field, s.editMessageInput]}
                  />
                </>
              )}
              <Text style={s.subtitle}>
                {actionDialog.action === "branch"
                  ? "갈래 만들기는 무료예요. 새 이야기를 연 뒤 직접 메시지를 보내면 선택한 대화 모드의 빛을 사용해요."
                  : `원래 메시지와 같은 대화 모드로 새 답장을 받아요. ${actionDialog.message.action_cost} 빛을 사용해요.`}
              </Text>
              {!!error && (
                <Text accessibilityRole="alert" style={s.error}>
                  {error}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={
                  actionSending ||
                  (actionDialog.action === "edit" && !actionContent.trim())
                }
                style={s.primary}
                onPress={() => confirmAction()}
              >
                <Text style={s.white}>
                  {actionDialog.action === "branch"
                    ? "무료로 새 이야기 만들기"
                    : `${actionDialog.message.action_cost} 빛으로 ${actionDialog.action === "edit" ? "수정하고 이어가기" : "다른 답장 보기"}`}
                </Text>
              </Pressable>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
      <Modal
        visible={sheet !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSheet(null)}
      >
        <SafeAreaView style={s.safe}>
          <View style={s.header}>
            <Text style={s.chatName}>
              {sheet === "memory"
                ? "기억과 우리 사이"
                : sheet === "wallet"
                  ? "이야기를 이어갈 빛"
                  : "나의 계정"}
            </Text>
            <View style={s.fill} />
            <Pressable onPress={() => setSheet(null)}>
              <Text style={s.link}>닫기</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.sheet}>
            {sheet === "memory" && chat && (
              <>
                <Text style={s.title}>{chat.relationship.stage}</Text>
                <Text style={s.subtitle}>
                  신뢰 {chat.relationship.trust}, 함께 협력한 순간{" "}
                  {chat.relationship.shared}
                </Text>
                {chat.relationship.last_change && (
                  <View style={s.memory}>
                    <Text style={s.author}>
                      {chat.relationship.last_change.reason}
                    </Text>
                    <Text style={s.messageText}>
                      “{chat.relationship.last_change.evidence}”
                    </Text>
                  </View>
                )}
                {Object.values(chat.narrative.story_slots ?? {})
                  .filter(
                    (item) =>
                      item.status === "active" && !item.key.startsWith("past."),
                  )
                  .slice(0, 4)
                  .map((item) => (
                    <View style={s.memory} key={item.key}>
                      <Text style={s.author}>
                        {item.key === "scene.goal"
                          ? "지금의 목표"
                          : item.key === "scene.place"
                            ? "이야기가 머무는 곳"
                            : "이어갈 이야기"}
                      </Text>
                      <Text style={s.messageText}>{item.value}</Text>
                    </View>
                  ))}
                <View style={s.setting}>
                  <Text style={s.cardRole}>대화 기억 사용</Text>
                  <Switch
                    value={chat.settings.memory_enabled}
                    disabled={chatBusy}
                    onValueChange={async (value) => {
                      const generation = chatGeneration.current;
                      try {
                        await api(`/v1/conversations/${chat.id}/settings`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            ...chat.settings,
                            memory_enabled: value,
                          }),
                        });
                        await reload(chat.id, generation);
                      } catch (e) {
                        if (isCurrentChat(chat.id, generation))
                          setError((e as Error).message);
                      }
                    }}
                  />
                </View>
                {chat.memories.map((m) => (
                  <View style={s.memory} key={m.id}>
                    <Text style={s.author}>{m.key}</Text>
                    <Text style={s.messageText}>{m.value}</Text>
                    <View style={s.memoryActions}>
                      <Pressable
                        disabled={chatBusy}
                        onPress={() => {
                          setMemoryKey(m.key);
                          setMemoryValue(m.value);
                        }}
                      >
                        <Text style={s.link}>수정</Text>
                      </Pressable>
                      <Pressable
                        disabled={chatBusy}
                        onPress={async () => {
                          const generation = chatGeneration.current;
                          try {
                            await api(`/v1/memories/${m.id}`, {
                              method: "DELETE",
                            });
                            await reload(chat.id, generation);
                          } catch (e) {
                            if (isCurrentChat(chat.id, generation))
                              setError((e as Error).message);
                          }
                        }}
                      >
                        <Text style={s.link}>지우기</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
                {(!!chat.narrative.episode_notes?.length ||
                  Object.keys(chat.narrative.story_slots ?? {}).length > 0) && (
                  <View>
                    <Text style={s.title}>기억에 남은 장면</Text>
                    {(chat.narrative.episode_notes ?? []).map((note) => (
                      <View style={s.memory} key={note.source_id}>
                        <Text style={s.author}>
                          {note.role === "user"
                            ? "내가 남긴 말"
                            : "캐릭터의 말"}
                        </Text>
                        <Text style={s.messageText}>{note.quote}</Text>
                      </View>
                    ))}
                    <Pressable
                      disabled={chatBusy}
                      onPress={async () => {
                        const generation = chatGeneration.current;
                        try {
                          await api(`/v1/conversations/${chat.id}/episodes`, {
                            method: "DELETE",
                          });
                          await reload(chat.id, generation);
                        } catch (e) {
                          if (isCurrentChat(chat.id, generation))
                            setError((e as Error).message);
                        }
                      }}
                    >
                      <Text style={s.link}>이전 장면 지우기</Text>
                    </Pressable>
                    <Text style={s.subtitle}>
                      이름, 취향, 약속 등의 기억 노트는 남아 있어요. 지우려면 각
                      노트에서 지우기를 눌러 주세요.
                    </Text>
                  </View>
                )}
                <Text style={s.subtitle}>
                  직접 고친 기억은 자동으로 덮어쓰지 않아요.
                </Text>
                <TextInput
                  accessibilityLabel="기억 제목"
                  style={s.field}
                  value={memoryKey}
                  onChangeText={setMemoryKey}
                  placeholder="기억 제목"
                  maxLength={40}
                />
                <TextInput
                  accessibilityLabel="기억 내용"
                  style={s.field}
                  value={memoryValue}
                  onChangeText={setMemoryValue}
                  placeholder="꼭 기억해 줬으면 하는 것"
                  maxLength={500}
                />
                <Pressable
                  disabled={
                    chatBusy || !memoryKey.trim() || !memoryValue.trim()
                  }
                  style={s.primary}
                  onPress={saveMemory}
                >
                  <Text style={s.white}>기억 저장하기</Text>
                </Pressable>
              </>
            )}
            {sheet === "wallet" && (
              <>
                <Text style={s.title}>✧ {user?.credits ?? 30} 빛</Text>
                <Text style={s.subtitle}>
                  짧은 대화 1 빛 · 깊은 이야기 3 빛
                </Text>
                {!nativeBillingAvailable ? (
                  <Text style={s.scene}>
                    스토어 연결을 준비하고 있어요. 지금은 계정에 보유한 빛으로
                    대화할 수 있습니다.
                  </Text>
                ) : !user?.email ? (
                  <Pressable
                    style={s.primary}
                    onPress={() => setSheet("account")}
                  >
                    <Text style={s.white}>결제 전에 계정 저장하기</Text>
                  </Pressable>
                ) : (
                  <>
                    {storePackages.map((item) => (
                      <Pressable
                        key={item.identifier}
                        disabled={purchasing}
                        style={s.primary}
                        onPress={() => buy(item)}
                      >
                        <Text style={s.white}>
                          {item.product.title} · {item.product.priceString}
                        </Text>
                      </Pressable>
                    ))}
                    <Text style={s.scene}>
                      {paymentNotice ||
                        "가격과 결제 수단은 스토어에서 확인할 수 있어요. 승인 후 빛이 계정에 반영됩니다."}
                    </Text>
                  </>
                )}
                <Pressable
                  style={s.primary}
                  onPress={async () => {
                    try {
                      await ensure();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <Text style={s.white}>잔액 다시 확인</Text>
                </Pressable>
              </>
            )}
            {sheet === "account" &&
              (user?.email ? (
                <>
                  <Text style={s.title}>{user.nickname}</Text>
                  <Text style={s.subtitle}>{user.email}</Text>
                  <Pressable
                    style={s.primary}
                    onPress={async () => {
                      try {
                        await api("/v1/auth/logout", { method: "POST" });
                        await SecureStore.deleteItemAsync("yeoun-token");
                        setUser(null);
                        setConvs([]);
                        close();
                        setSheet(null);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <Text style={s.white}>로그아웃</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={s.title}>이야기를 간직하세요</Text>
                  <Text style={s.subtitle}>
                    웹에서 만든 계정으로도 이어갈 수 있어요.
                  </Text>
                  {register && (
                    <TextInput
                      accessibilityLabel="닉네임"
                      style={s.field}
                      value={nickname}
                      onChangeText={setNickname}
                      placeholder="어떻게 불러드릴까요?"
                      maxLength={30}
                    />
                  )}
                  <TextInput
                    accessibilityLabel="이메일"
                    style={s.field}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="이메일"
                  />
                  <TextInput
                    accessibilityLabel="비밀번호"
                    style={s.field}
                    secureTextEntry
                    autoCapitalize="none"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="비밀번호 (12자 이상)"
                    maxLength={128}
                  />
                  <Pressable style={s.primary} onPress={auth}>
                    <Text style={s.white}>
                      {register ? "계정에 저장하기" : "로그인"}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => setRegister(!register)}>
                    <Text
                      style={[s.link, { textAlign: "center", marginTop: 20 }]}
                    >
                      {register ? "이미 계정이 있어요" : "새 계정 만들기"}
                    </Text>
                  </Pressable>
                </>
              ))}
            {error && (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  hero: {
    height: 202,
    backgroundColor: "#23283d",
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 20,
  },
  heroImage: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: "53%",
    height: "100%",
    resizeMode: "cover",
  },
  heroCopy: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "53%",
    padding: 18,
    backgroundColor: "#23283d",
  },
  heroLabel: { fontSize: 9, color: "#cdd5ee" },
  heroTitle: {
    fontSize: 20,
    lineHeight: 29,
    color: "#fff",
    fontWeight: "700",
    marginTop: 19,
  },
  heroLink: { fontSize: 10, color: "#ffb7c6", marginTop: 20 },
  genderTabs: {
    flexDirection: "row",
    gap: 20,
    borderBottomWidth: 1,
    borderColor: "#2a2c35",
    marginBottom: 14,
  },
  genderTab: { paddingVertical: 13 },
  genderSelected: { borderBottomWidth: 2, borderColor: "#ff6b85" },
  styleSwitch: {
    flexDirection: "row",
    backgroundColor: "#20222a",
    padding: 3,
    borderRadius: 8,
    alignSelf: "flex-start",
    marginBottom: 14,
  },
  styleOption: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 5 },
  styleSelected: { backgroundColor: "#3b3443" },
  artBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    color: "#fff",
    fontSize: 9,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: "#1c1c2bb0",
  },
  safe: { flex: 1, backgroundColor: "#111216" },
  fill: { flex: 1 },
  header: {
    height: 65,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
    borderBottomWidth: 1,
    borderColor: "#2a2c35",
  },
  logo: {
    fontSize: 29,
    fontWeight: "800",
    letterSpacing: -1.4,
    color: "#fff8f4",
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandIcon: { width: 32, height: 32 },
  logoDot: { color: "#ff718e" },
  link: { fontSize: 12, color: "#ff8aa0", paddingVertical: 8 },
  demo: {
    backgroundColor: "#342c21",
    textAlign: "center",
    padding: 7,
    fontSize: 9,
    color: "#efd3a3",
  },
  catalog: { padding: 20, paddingBottom: 40 },
  eyebrow: { fontSize: 9, letterSpacing: 2, color: "#ff7f97", marginTop: 8 },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#f6f6f8",
    marginTop: 13,
    lineHeight: 35,
  },
  subtitle: {
    fontSize: 12,
    color: "#999ba9",
    marginTop: 10,
    lineHeight: 21,
    marginBottom: 15,
  },
  search: {
    padding: 14,
    backgroundColor: "#20222a",
    borderRadius: 10,
    fontSize: 12,
    marginBottom: 16,
    color: "#e4e4ea",
  },
  chips: { gap: 8, paddingBottom: 18, alignItems: "center" },
  chip: {
    borderWidth: 1,
    borderColor: "#343641",
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 25,
  },
  selected: { backgroundColor: "#553347", borderColor: "#553347" },
  chipText: { fontSize: 11, color: "#b4b5c1" },
  white: { color: "#fff2f6", fontSize: 13 },
  gridRow: { gap: 15 },
  card: { flex: 1, maxWidth: "48%", marginBottom: 26 },
  poster: {
    width: "100%",
    aspectRatio: 0.75,
    borderRadius: 10,
    resizeMode: "cover",
  },
  cardName: {
    fontSize: 18,
    color: "#f3f3f6",
    fontWeight: "600",
    marginTop: 12,
  },
  small: { fontSize: 10, color: "#a1a4b2", fontWeight: "400", lineHeight: 18 },
  cardRole: { fontSize: 11, color: "#bbbcc6", marginTop: 6, lineHeight: 18 },
  cardTag: { fontSize: 10, color: "#9396a5", marginTop: 10 },
  bottomNav: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: 20,
    borderTopWidth: 1,
    borderColor: "#32343f",
    backgroundColor: "#181a21",
  },
  navText: { fontSize: 13, color: "#a0a3b2" },
  active: { color: "#ff6b85", fontWeight: "700" },
  back: { fontSize: 32, color: "#b2a6c1" },
  avatar: { width: 38, height: 38, borderRadius: 20 },
  chatName: { fontSize: 15, color: "#f4f4f8", fontWeight: "600" },
  messages: { padding: 20, paddingBottom: 35 },
  scene: {
    fontSize: 12,
    lineHeight: 23,
    color: "#999cad",
    textAlign: "center",
    paddingVertical: 25,
  },
  message: { padding: 16, borderRadius: 13, marginBottom: 22, maxWidth: "95%" },
  assistantMessage: {
    backgroundColor: "#21242e",
    borderWidth: 1,
    borderColor: "#2e3140",
    alignSelf: "flex-start",
    borderTopLeftRadius: 0,
  },
  userMessage: {
    backgroundColor: "#51384d",
    alignSelf: "flex-end",
    borderTopRightRadius: 0,
  },
  author: { fontSize: 10, color: "#d2b7cf", marginBottom: 8 },
  messageText: { fontSize: 14, color: "#e1e3ec", lineHeight: 25 },
  messageActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginTop: 10,
  },
  messageAction: { minHeight: 44, justifyContent: "center" },
  messageActionText: { color: "#bda5bc", fontSize: 12, paddingVertical: 8 },
  branchBanner: {
    paddingHorizontal: 20,
    paddingVertical: 7,
    backgroundColor: "#211e29",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  branchLabel: { color: "#c9a6bf", fontSize: 10, marginTop: 5 },
  branchProgress: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
  editMessageInput: {
    minHeight: 140,
    textAlignVertical: "top",
    lineHeight: 24,
  },
  replyStatus: { fontSize: 11, color: "#b8a0b4", marginTop: 12 },
  latestButton: {
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 6,
    backgroundColor: "#36303f",
    borderColor: "#625069",
    borderWidth: 1,
    borderRadius: 22,
  },
  latestLabel: { color: "#ffe5ec", fontSize: 12, fontWeight: "600" },
  resumeNotice: {
    backgroundColor: "#292531",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  composerWrap: { padding: 14, paddingTop: 7 },
  composer: {
    backgroundColor: "#20232e",
    borderWidth: 1,
    borderColor: "#3a3e50",
    borderRadius: 13,
    padding: 13,
  },
  messageInput: {
    fontSize: 14,
    minHeight: 43,
    maxHeight: 110,
    color: "#e1e3ec",
    textAlignVertical: "top",
  },
  composerFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 7,
  },
  send: {
    width: 35,
    height: 35,
    backgroundColor: "#ff6b85",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: "#251821", fontSize: 24 },
  disabled: { opacity: 0.4 },
  disclaimer: {
    textAlign: "center",
    color: "#9197a8",
    fontSize: 8,
    marginTop: 9,
  },
  errorBar: {
    padding: 12,
    backgroundColor: "#492832",
    borderTopWidth: 1,
    borderColor: "#75404f",
  },
  error: { fontSize: 12, color: "#ffb4c4", lineHeight: 20, marginVertical: 8 },
  sheet: { padding: 24, paddingBottom: 60 },
  field: {
    borderWidth: 1,
    borderColor: "#3b3d4a",
    borderRadius: 8,
    padding: 14,
    fontSize: 14,
    backgroundColor: "#191c25",
    marginVertical: 8,
    color: "#dedfe9",
  },
  primary: {
    backgroundColor: "#663e56",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 15,
  },
  memory: {
    padding: 17,
    backgroundColor: "#191c25",
    borderWidth: 1,
    borderColor: "#353948",
    borderRadius: 10,
    marginVertical: 9,
  },
  memoryActions: {
    flexDirection: "row",
    gap: 20,
    justifyContent: "flex-end",
    marginTop: 9,
  },
  setting: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 15,
  },
  chatRow: {
    flexDirection: "row",
    gap: 15,
    alignItems: "center",
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderColor: "#2a2c35",
  },
  rowAvatar: { width: 65, height: 80, borderRadius: 9 },
});
