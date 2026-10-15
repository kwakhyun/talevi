const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
// Contract-level regression harness: executes the actual component callbacks with
// mocked React hooks and native modules. It does not validate native rendering.

const ts = require("typescript");
const source =
  fs
    .readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8")
    .replace(
      "  return (\n    <SafeAreaView style={s.safe}>",
      "  globalThis.__capture = {open, close, send, follow, changeDraft, reload, jumpToLatest, setChars, chooseAction, confirmAction, setActionContent, actionContent, actionDialog, actionSending, pendingAction, chat, draft, sending, stream, error, resumeTurn, replyPhase, scroll, nearBottom};\n  return (\n    <SafeAreaView style={s.safe}>",
    ) + "\nexports.__Experience = Experience;";
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setImmediate(r));
const char = {
  id: "one",
  name: "테스트",
  tags: [],
  starters: [],
  appearance: {},
};
function conv(id, active_turn = null, messages = []) {
  return {
    id,
    character_id: "one",
    active_turn,
    messages,
    memories: [],
    settings: { memory_enabled: true },
    relationship: { stage: "첫 만남", trust: 0, shared: 0 },
    narrative: { chapter: 1 },
  };
}
function stream(events) {
  return {
    ok: true,
    body: new ReadableStream({
      start(c) {
        for (const [id, event, data] of events)
          c.enqueue(
            new TextEncoder().encode(
              `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        c.close();
      },
    }),
  };
}
function harness(options = {}) {
  const slots = [];
  let index = 0,
    haptics = 0,
    nextClientId = 0;
  const calls = [],
    storage = options.storage || new Map();
  let apiHandler, streamHandler;
  class ApiError extends Error {
    constructor(status, msg) {
      super(msg);
      this.status = status;
    }
  }
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: props || {},
      children,
    }),
    useState: (init) => {
      const n = index++;
      if (!(n in slots)) slots[n] = init;
      return [
        slots[n],
        (v) => (slots[n] = typeof v === "function" ? v(slots[n]) : v),
      ];
    },
    useRef: (init) => {
      const n = index++;
      if (!(n in slots)) slots[n] = { current: init };
      return slots[n];
    },
    useEffect: () => {},
  };
  const api = async (path, opts = {}) => {
    calls.push({ path, ...opts });
    if (path === "/v1/me") {
      if (options.meError) throw options.meError;
      return { id: "me", credits: 20 };
    }
    if (path === "/v1/conversations") return [];
    return apiHandler(path, opts);
  };
  const modules = {
    react,
    "./billing": { nativeBillingAvailable: false },
    "react-native": new Proxy(
      { StyleSheet: { create: (x) => x }, Platform: { OS: "ios" } },
      { get: (t, p) => t[p] || p },
    ),
    "react-native-safe-area-context": {
      SafeAreaView: "SafeAreaView",
      SafeAreaProvider: "SafeAreaProvider",
    },
    "expo-status-bar": { StatusBar: "StatusBar" },
    "expo-secure-store": { getItemAsync: async () => "token" },
    "expo-crypto": { randomUUID: () => `client-${++nextClientId}` },
    "expo-haptics": {
      NotificationFeedbackType: { Success: "success" },
      notificationAsync: async () => haptics++,
    },
    "@react-native-async-storage/async-storage": {
      getItem: async (k) =>
        options.getItem ? options.getItem(k, storage) : storage.get(k) || null,
      setItem: async (k, v) =>
        options.setItem ? options.setItem(k, v, storage) : storage.set(k, v),
      removeItem: async (k) => storage.delete(k),
    },
    "expo/fetch": { fetch: (...args) => streamHandler(...args) },
    "@yeoun/contracts": {
      createApi: () => api,
      ApiError,
      ko: { aiNotice: "AI" },
      parseSseBlock: (block) => {
        let id, event, data;
        for (const line of block.split("\n")) {
          if (line.startsWith("id:")) id = Number(line.slice(3));
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data = JSON.parse(line.slice(5));
        }
        return { id, event, data };
      },
    },
  };
  const context = {
    exports: {},
    require: (n) =>
      n.endsWith(".png")
        ? 1
        : modules[n] ||
          (() => {
            throw new Error(n);
          })(),
    process: { env: {} },
    console,
    AbortController,
    TextDecoder,
    setTimeout: (fn, ms) => setTimeout(fn, ms >= 500 ? 0 : ms),
    clearTimeout,
  };
  vm.runInNewContext(compiled, context);
  const render = () => {
    index = 0;
    const tree = context.exports.__Experience();
    return { view: context.__capture, tree };
  };
  return {
    render,
    get view() {
      return render().view;
    },
    calls,
    storage,
    setApi: (f) => (apiHandler = f),
    setStream: (f) => (streamHandler = f),
    get haptics() {
      return haptics;
    },
    ApiError,
  };
}
(async () => {
  let count = 0;
  // A late GET must not reopen a closed conversation.
  {
    const h = harness();
    h.setApi(async () => conv("a"));
    await h.view.open(char, "a");
    const late = deferred();
    h.setApi(() => late.promise);
    const p = h.view.reload("a");
    h.view.close();
    late.resolve(conv("a"));
    await p;
    assert.equal(h.view.chat, null);
    count++;
  }
  // An accepted POST from the previous view must not replace a newer conversation.
  {
    const h = harness();
    const post = deferred();
    h.setApi((p, o) =>
      o.method === "POST"
        ? post.promise
        : Promise.resolve(conv(p.endsWith("/b") ? "b" : "a")),
    );
    await h.view.open(char, "a");
    h.view.changeDraft("첫 말");
    const p = h.view.send("첫 말");
    await tick();
    await h.view.open(char, "b");
    post.resolve({ id: "turn-a" });
    await p;
    assert.equal(h.view.chat.id, "b");
    assert.equal(h.view.resumeTurn, null);
    count++;
  }
  // New text typed while a POST is pending survives; a server failure never emits success haptics.
  {
    const h = harness();
    const post = deferred();
    let sent = false;
    h.setApi((p, o) =>
      o.method === "POST"
        ? post.promise
        : Promise.resolve(
            conv(
              "a",
              null,
              sent
                ? [
                    {
                      id: "u",
                      role: "user",
                      content: "첫 말",
                      status: "failed",
                      turn_id: "turn-a",
                    },
                  ]
                : [],
            ),
          ),
    );
    h.setStream(async () => stream([[1, "failed", { message: "환급됨" }]]));
    await h.view.open(char, "a");
    h.view.changeDraft("첫 말");
    const p = h.view.send("첫 말");
    await tick();
    h.view.changeDraft("다음 말");
    sent = true;
    post.resolve({ id: "turn-a" });
    await p;
    assert.equal(h.view.draft, "다음 말");
    assert.equal(h.haptics, 0);
    assert.equal(h.view.resumeTurn, null);
    assert.equal(h.view.sending, false);
    count++;
  }
  // Missing SSE terminal events recover a persisted reply without posting another turn.
  {
    const h = harness();
    let reads = 0;
    h.setApi(async (p, o) => {
      if (o.method === "POST") return { id: "turn-a" };
      reads++;
      return conv(
        "a",
        reads === 2 ? "turn-a" : null,
        reads > 2
          ? [
              {
                id: "a",
                role: "assistant",
                content: "저장된 답장",
                turn_id: "turn-a",
              },
            ]
          : [],
      );
    });
    h.setStream(async () => {
      throw new Error("offline");
    });
    await h.view.open(char, "a");
    h.view.changeDraft("첫 말");
    await h.view.send("첫 말");
    assert.equal(h.view.resumeTurn, null);
    assert.equal(h.view.chat.messages[0].content, "저장된 답장");
    assert.equal(h.haptics, 1);
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 1);
    count++;
  }
  // Exhausted reconnect keeps the same turn ID; a manual reconnect issues only GETs.
  {
    const h = harness();
    let sent = false,
      done = false;
    h.setApi(async (p, o) => {
      if (o.method === "POST") {
        sent = true;
        return { id: "turn-a" };
      }
      return conv(
        "a",
        sent && !done ? "turn-a" : null,
        done
          ? [
              {
                id: "a",
                role: "assistant",
                content: "복구됨",
                turn_id: "turn-a",
              },
            ]
          : [],
      );
    });
    h.setStream(async () => {
      throw new Error("offline");
    });
    await h.view.open(char, "a");
    h.view.changeDraft("첫 말");
    await h.view.send("첫 말");
    assert.equal(h.view.resumeTurn.turnId, "turn-a");
    assert.equal(h.view.replyPhase, "paused");
    h.view.changeDraft("다음 질문");
    await h.view.send("다음 질문");
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 1);
    done = true;
    h.setStream(async (url) => {
      assert.match(url, /turn-a\/events/);
      return stream([[1, "done", {}]]);
    });
    await h.view.follow("a", "turn-a");
    assert.equal(h.view.resumeTurn, null);
    assert.equal(h.view.draft, "다음 질문");
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 1);
    count++;
  }
  // Confirmed 4xx rejection leaves the user free to edit and send another message.
  {
    const h = harness();
    h.setApi(async (p, o) => {
      if (o.method === "POST") throw new h.ApiError(402, "빛 부족");
      return conv("a");
    });
    await h.view.open(char, "a");
    h.view.changeDraft("첫 말");
    await h.view.send("첫 말");
    h.view.changeDraft("수정한 말");
    await h.view.send("수정한 말");
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 2);
    assert.equal(h.view.draft, "수정한 말");
    count++;
  }
  // Unknown POST outcome must reuse the idempotency key and preserve a new draft.
  {
    const h = harness();
    let sent = false;
    h.setApi(async (p, o) => {
      if (o.method === "POST") {
        if (!sent) {
          sent = true;
          throw new Error("connection lost");
        }
        return { id: "turn-a" };
      }
      return conv(
        "a",
        null,
        sent
          ? [
              {
                id: "a",
                role: "assistant",
                content: "복구됨",
                turn_id: "turn-a",
              },
            ]
          : [],
      );
    });
    h.setStream(async () => stream([[1, "done", {}]]));
    await h.view.open(char, "a");
    h.view.changeDraft("첫 말");
    await h.view.send("첫 말");
    h.view.changeDraft("다음 말");
    await h.view.send("다음 말");
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 1);
    await h.view.send("첫 말", null, true);
    const posts = h.calls.filter((x) => x.method === "POST");
    assert.equal(posts.length, 2);
    assert.equal(
      JSON.parse(posts[0].body).client_id,
      JSON.parse(posts[1].body).client_id,
    );
    assert.equal(h.view.draft, "다음 말");
    count++;
  }
  // Opening and leaving before draft hydration must not erase a saved draft.
  {
    const storage = new Map([["draft:a", "아직 보내지 않은 말"]]);
    const read = deferred();
    const h = harness({
      storage,
      getItem: (key, values) =>
        key === "draft:a" ? read.promise : values.get(key) || null,
    });
    h.setApi(async () => conv("a"));
    const opening = h.view.open(char, "a");
    for (let i = 0; i < 4; i++) await tick();
    assert.equal(h.view.chat.id, "a");
    h.view.close();
    read.resolve("아직 보내지 않은 말");
    await opening;
    await tick();
    assert.equal(storage.get("draft:a"), "아직 보내지 않은 말");
    count++;
  }
  // An unknown POST receipt persists across a fresh app instance and reuses its key.
  {
    const storage = new Map();
    const first = harness({ storage });
    first.setApi(async (p, o) => {
      if (o.method === "POST") throw new Error("lost response");
      return conv("a");
    });
    await first.view.open(char, "a");
    first.view.changeDraft("원래 전송");
    await first.view.send("원래 전송");
    const stored = JSON.parse(storage.get("pending-turn:a"));
    assert.equal(stored.content, "원래 전송");
    first.view.close();
    await tick();
    const restarted = harness({ storage });
    let posts = 0;
    let streamRequests = 0;
    restarted.setApi(async (p, o) => {
      if (o.method === "POST") {
        posts++;
        assert.equal(JSON.parse(o.body).client_id, stored.client_id);
        return { id: "existing-turn" };
      }
      return conv("a", null, [
        {
          id: "a",
          role: "assistant",
          turn_id: "existing-turn",
          content: "이미 저장한 답장",
        },
      ]);
    });
    restarted.setStream(() => {
      streamRequests++;
      throw new Error("completed replies must not replay SSE");
    });
    await restarted.view.open(char, "a");
    await restarted.view.send("새로운 말");
    assert.equal(posts, 0);
    await restarted.view.send(stored.content, null, true);
    assert.equal(posts, 1);
    assert.equal(streamRequests, 0);
    assert.equal(restarted.view.resumeTurn, null);
    assert.equal(storage.has("pending-turn:a"), false);
    count++;
  }
  // If durable pending storage is unavailable, no message can be dispatched.
  {
    const h = harness({
      setItem: (key, value, values) => {
        if (key.startsWith("pending-turn:"))
          throw new Error("disk unavailable");
        values.set(key, value);
      },
    });
    h.setApi(async (p, o) => {
      assert.notEqual(o.method, "POST");
      return conv("a");
    });
    await h.view.open(char, "a");
    h.view.changeDraft("저장해야 하는 말");
    await h.view.send("저장해야 하는 말");
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 0);
    assert.equal(h.view.draft, "저장해야 하는 말");
    count++;
  }
  // A late receipt cleans up only its own pending key, not a newer request.
  {
    const storage = new Map();
    const h = harness({ storage });
    const post = deferred();
    h.setApi((p, o) =>
      o.method === "POST" ? post.promise : Promise.resolve(conv("a")),
    );
    await h.view.open(char, "a");
    h.view.changeDraft("첫 말");
    const sending = h.view.send("첫 말");
    await tick();
    assert.equal(
      JSON.parse(storage.get("pending-turn:a")).client_id,
      "client-1",
    );
    h.view.close();
    const newer = {
      client_id: "newer-key",
      content: "다음 전송",
      mode: "quick",
      story_event: null,
    };
    storage.set("pending-turn:a", JSON.stringify(newer));
    post.resolve({ id: "turn-a" });
    await sending;
    assert.equal(
      JSON.parse(storage.get("pending-turn:a")).client_id,
      "newer-key",
    );
    assert.equal(h.view.chat, null);
    count++;
  }
  // A stale-view receipt removes its matching durable key without reopening the chat.
  {
    const storage = new Map();
    const h = harness({ storage });
    const post = deferred();
    h.setApi((p, o) =>
      o.method === "POST" ? post.promise : Promise.resolve(conv("a")),
    );
    await h.view.open(char, "a");
    h.view.changeDraft("첫 말");
    const sending = h.view.send("첫 말");
    await tick();
    h.view.close();
    post.resolve({ id: "turn-a" });
    await sending;
    assert.equal(storage.has("pending-turn:a"), false);
    assert.equal(h.view.chat, null);
    count++;
  }
  // A network outage must not replace an existing account with a new guest.
  {
    const h = harness({ meError: new Error("offline") });
    h.setApi(() => {
      throw new Error("must not create a guest");
    });
    await h.view.open(char, "a");
    assert.equal(
      h.calls.some((x) => x.path === "/v1/auth/guest"),
      false,
    );
    assert.equal(h.view.chat, null);
    count++;
  }
  // Reading older messages stops auto-scroll; the explicit jump restores it.
  {
    const h = harness();
    h.setApi(async () => conv("a"));
    h.view.setChars([char]);
    await h.view.open(char, "a");
    let jumps = 0;
    h.view.scroll.current = { scrollToEnd: () => jumps++ };
    const all = [];
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      all.push(node);
      for (const child of node.children || [])
        Array.isArray(child) ? child.forEach(visit) : visit(child);
    };
    visit(h.render().tree);
    const messages = all.find(
      (node) => node.type === "ScrollView" && node.props.onContentSizeChange,
    );
    messages.props.onScroll({
      nativeEvent: {
        contentSize: { height: 1000 },
        layoutMeasurement: { height: 400 },
        contentOffset: { y: 100 },
      },
    });
    messages.props.onContentSizeChange();
    assert.equal(jumps, 0);
    messages.props.onScroll({
      nativeEvent: {
        contentSize: { height: 1000 },
        layoutMeasurement: { height: 400 },
        contentOffset: { y: 600 },
      },
    });
    messages.props.onContentSizeChange();
    assert.equal(jumps, 1);
    h.view.jumpToLatest();
    assert.equal(jumps, 2);
    count++;
  }
  // SSE phases reach the visible state, and terminal failure still avoids success haptics.
  {
    const h = harness();
    let sent = false,
      failed = false,
      controller;
    h.setApi(async (p, o) => {
      if (o.method === "POST") {
        sent = true;
        return { id: "turn-a" };
      }
      return conv(
        "a",
        sent && !failed ? "turn-a" : null,
        failed
          ? [
              {
                id: "u",
                role: "user",
                status: "failed",
                turn_id: "turn-a",
                content: "첫 말",
              },
            ]
          : [],
      );
    });
    h.setStream(async () => ({
      ok: true,
      body: new ReadableStream({
        start(c) {
          controller = c;
        },
      }),
    }));
    await h.view.open(char, "a");
    h.view.changeDraft("첫 말");
    const sending = h.view.send("첫 말");
    for (let i = 0; i < 4 && !controller; i++) await tick();
    controller.enqueue(
      new TextEncoder().encode(
        'id: 1\nevent: phase\ndata: {"name":"writing"}\n\n',
      ),
    );
    await tick();
    assert.equal(h.view.replyPhase, "writing");
    failed = true;
    controller.enqueue(
      new TextEncoder().encode(
        'id: 2\nevent: failed\ndata: {"message":"환급됨"}\n\n',
      ),
    );
    controller.close();
    await sending;
    assert.equal(h.haptics, 0);
    assert.equal(h.view.sending, false);
    count++;
  }
  // A stale reload must not invalidate the in-flight load of a different chat.
  {
    const h = harness();
    h.setApi(async () => conv("a"));
    await h.view.open(char, "a");
    const read = deferred();
    h.setApi((url) =>
      url.endsWith("/b") ? read.promise : Promise.resolve(conv("a")),
    );
    const opening = h.view.open(char, "b");
    for (let i = 0; i < 4; i++) await tick();
    await h.view.reload("a");
    read.resolve(conv("b"));
    await opening;
    assert.equal(h.view.chat.id, "b");
    count++;
  }
  const actionMessage = (role = "assistant") => ({
    id: role === "assistant" ? "reply-1" : "user-1",
    role,
    content: role === "assistant" ? "함께 걸어볼까?" : "같이 걸어줘.",
    status: "completed",
    turn_id: "old-turn",
    created: 1,
    actions: {
      branch: role === "assistant",
      regenerate: role === "assistant",
      edit: role === "user",
    },
    action_cost: 3,
  });
  // Branching requires explicit confirmation and only posts to the branch endpoint.
  {
    const h = harness();
    const message = actionMessage();
    const original = conv("a", null, [message]);
    const target = {
      ...conv("fork", null, [message]),
      branch: { parent_id: "a", message_id: message.id, action: "branch" },
    };
    h.view.setChars([char]);
    h.setApi(async (url, o) =>
      o.method === "POST"
        ? {
            conversation_id: "fork",
            turn_id: null,
            status: "completed",
            cost: 0,
          }
        : url.endsWith("/fork")
          ? target
          : original,
    );
    await h.view.open(char, "a");
    h.view.changeDraft("원본에 남길 초안");
    h.view.chooseAction(message, "branch");
    assert.equal(h.view.actionDialog.action, "branch");
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 0);
    await h.view.confirmAction();
    assert.equal(h.view.chat.id, "fork");
    assert.equal(h.view.chat.branch.parent_id, "a");
    const posts = h.calls.filter((x) => x.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].path, "/v1/conversations/a/branches");
    assert.equal(JSON.parse(posts[0].body).action, "branch");
    assert.equal(h.storage.get("draft:a"), "원본에 남길 초안");
    assert.equal(original.messages.length, 1);
    count++;
  }
  // Regeneration follows the turn created by the branch API without a second ordinary POST.
  {
    const h = harness();
    const message = actionMessage();
    let complete = false,
      streams = 0;
    h.view.setChars([char]);
    h.setApi(async (url, o) => {
      if (o.method === "POST")
        return {
          conversation_id: "fork",
          turn_id: "new-turn",
          status: "queued",
          cost: 3,
        };
      if (url.endsWith("/fork"))
        return conv(
          "fork",
          complete ? null : "new-turn",
          complete
            ? [{ ...message, id: "new-reply", turn_id: "new-turn" }]
            : [],
        );
      return conv("a", null, [message]);
    });
    h.setStream(async (url) => {
      streams++;
      assert.match(url, /new-turn\/events/);
      complete = true;
      return stream([[1, "done", {}]]);
    });
    await h.view.open(char, "a");
    h.view.chooseAction(message, "regenerate");
    await h.view.confirmAction();
    for (let i = 0; i < 4; i++) await tick();
    assert.equal(h.view.chat.id, "fork");
    assert.equal(h.view.resumeTurn, null);
    assert.equal(streams, 1);
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 1);
    count++;
  }
  // Editing sends the changed text to a new branch and retains the original transcript.
  {
    const h = harness();
    const message = actionMessage("user");
    const original = conv("a", null, [message]);
    h.view.setChars([char]);
    h.setApi(async (url, o) =>
      o.method === "POST"
        ? {
            conversation_id: "fork",
            turn_id: null,
            status: "completed",
            cost: 3,
          }
        : url.endsWith("/fork")
          ? conv("fork")
          : original,
    );
    await h.view.open(char, "a");
    h.view.chooseAction(message, "edit");
    assert.equal(h.view.actionContent, message.content);
    h.view.setActionContent("잠깐, 바닷가로 가자.");
    await h.view.confirmAction();
    const request = JSON.parse(h.calls.find((x) => x.method === "POST").body);
    assert.equal(request.action, "edit");
    assert.equal(request.message_id, "user-1");
    assert.equal(request.content, "잠깐, 바닷가로 가자.");
    assert.equal(original.messages[0].content, "같이 걸어줘.");
    assert.equal(h.view.chat.id, "fork");
    count++;
  }
  // Legacy messages without capabilities cannot open a confirmation or send an action.
  {
    const h = harness();
    h.view.setChars([char]);
    const legacy = { ...actionMessage(), actions: undefined };
    h.setApi(async () => conv("a", null, [legacy]));
    await h.view.open(char, "a");
    h.view.chooseAction(legacy, "regenerate");
    await h.view.confirmAction();
    assert.equal(h.view.actionDialog, null);
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 0);
    count++;
  }
  // Unknown branch results persist across app restart and block ordinary sends until resolved.
  {
    const storage = new Map();
    const message = actionMessage();
    const first = harness({ storage });
    first.view.setChars([char]);
    first.setApi(async (url, o) => {
      if (o.method === "POST") throw new Error("lost branch receipt");
      return conv("a", null, [message]);
    });
    await first.view.open(char, "a");
    first.view.chooseAction(message, "regenerate");
    await first.view.confirmAction();
    const stored = JSON.parse(storage.get("pending-action:a"));
    first.view.close();
    const restarted = harness({ storage });
    restarted.view.setChars([char]);
    restarted.setApi(async (url, o) => {
      if (o.method === "POST") {
        assert.equal(JSON.parse(o.body).client_id, stored.client_id);
        return {
          conversation_id: "fork",
          turn_id: null,
          status: "completed",
          cost: 3,
        };
      }
      return url.endsWith("/fork") ? conv("fork") : conv("a", null, [message]);
    });
    await restarted.view.open(char, "a");
    restarted.view.changeDraft("중복 전송 금지");
    await restarted.view.send("중복 전송 금지");
    assert.equal(restarted.calls.filter((x) => x.method === "POST").length, 0);
    await restarted.view.confirmAction(true);
    assert.equal(restarted.view.chat.id, "fork");
    assert.equal(restarted.calls.filter((x) => x.method === "POST").length, 1);
    assert.equal(storage.has("pending-action:a"), false);
    count++;
  }
  // Once accepted, even a 4xx target-load error must retain the original idempotency key.
  {
    const h = harness();
    const message = actionMessage();
    let loadFails = true;
    h.view.setChars([char]);
    h.setApi(async (url, o) => {
      if (o.method === "POST")
        return {
          conversation_id: "fork",
          turn_id: null,
          status: "completed",
          cost: 0,
        };
      if (url.endsWith("/fork")) {
        if (loadFails) throw new h.ApiError(429, "잠시 뒤 다시 시도");
        return conv("fork");
      }
      return conv("a", null, [message]);
    });
    await h.view.open(char, "a");
    h.view.chooseAction(message, "branch");
    await h.view.confirmAction();
    const stored = JSON.parse(h.storage.get("pending-action:a"));
    assert.equal(h.view.chat.id, "a");
    loadFails = false;
    await h.view.confirmAction(true);
    const requests = h.calls.filter((x) => x.method === "POST");
    assert.equal(requests.length, 2);
    assert.equal(JSON.parse(requests[1].body).client_id, stored.client_id);
    assert.equal(h.view.chat.id, "fork");
    count++;
  }
  // A branch cannot dispatch if its durable request could not be saved.
  {
    const h = harness({
      setItem: (key, value, values) => {
        if (key.startsWith("pending-action:"))
          throw new Error("storage unavailable");
        values.set(key, value);
      },
    });
    const message = actionMessage();
    h.view.setChars([char]);
    h.setApi(async () => conv("a", null, [message]));
    await h.view.open(char, "a");
    h.view.chooseAction(message, "branch");
    await h.view.confirmAction();
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 0);
    assert.equal(h.view.chat.id, "a");
    count++;
  }
  // A branch receipt arriving after a conversation switch must never steal focus.
  {
    const h = harness();
    const message = actionMessage();
    const result = deferred();
    h.view.setChars([char]);
    h.setApi((url, o) =>
      o.method === "POST"
        ? result.promise
        : Promise.resolve(
            conv(url.endsWith("/b") ? "b" : "a", null, [message]),
          ),
    );
    await h.view.open(char, "a");
    h.view.chooseAction(message, "branch");
    const creating = h.view.confirmAction();
    await tick();
    await h.view.open(char, "b");
    result.resolve({
      conversation_id: "fork",
      turn_id: null,
      status: "completed",
      cost: 0,
    });
    await creating;
    assert.equal(h.view.chat.id, "b");
    assert.equal(h.storage.has("pending-action:a"), false);
    assert.equal(
      h.calls.some((x) => x.path === "/v1/conversations/fork"),
      false,
    );
    count++;
  }
  // Double confirmation cannot dispatch two branch requests.
  {
    const h = harness();
    const message = actionMessage();
    const result = deferred();
    h.view.setChars([char]);
    h.setApi((url, o) =>
      o.method === "POST"
        ? result.promise
        : Promise.resolve(
            url.endsWith("/fork") ? conv("fork") : conv("a", null, [message]),
          ),
    );
    await h.view.open(char, "a");
    h.view.chooseAction(message, "branch");
    const first = h.view.confirmAction();
    const second = h.view.confirmAction();
    await tick();
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 1);
    result.resolve({
      conversation_id: "fork",
      turn_id: null,
      status: "completed",
      cost: 0,
    });
    await Promise.all([first, second]);
    assert.equal(h.view.chat.id, "fork");
    count++;
  }
  // A rejected edit preserves its text and permits a corrected request with a new key.
  {
    const h = harness();
    const message = actionMessage("user");
    let reject = true;
    h.view.setChars([char]);
    h.setApi(async (url, o) => {
      if (o.method === "POST") {
        if (reject) throw new h.ApiError(402, "빛 부족");
        return {
          conversation_id: "fork",
          turn_id: null,
          status: "completed",
          cost: 3,
        };
      }
      return url.endsWith("/fork") ? conv("fork") : conv("a", null, [message]);
    });
    await h.view.open(char, "a");
    h.view.chooseAction(message, "edit");
    h.view.setActionContent("수정 중인 문장");
    await h.view.confirmAction();
    assert.equal(h.view.actionContent, "수정 중인 문장");
    assert.equal(h.view.actionDialog.action, "edit");
    assert.equal(h.storage.has("pending-action:a"), false);
    reject = false;
    await h.view.confirmAction();
    const posts = h.calls.filter((x) => x.method === "POST");
    assert.notEqual(
      JSON.parse(posts[0].body).client_id,
      JSON.parse(posts[1].body).client_id,
    );
    assert.equal(h.view.chat.id, "fork");
    count++;
  }
  console.log(
    `Mobile async smoke: ${count} scenarios passed (mocked native modules; no device UI coverage).`,
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
