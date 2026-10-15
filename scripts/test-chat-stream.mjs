// Fault-injection tests against the actual TypeScript SSE client, without a browser or model calls.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const contracts = moduleUrl(
  compile(
    await readFile(
      new URL("../packages/contracts/src/index.ts", import.meta.url),
      "utf8",
    ),
  ),
);
const source = compile(
  await readFile(new URL("../apps/web/lib/api.ts", import.meta.url), "utf8"),
);
const { followTurn } = await import(
  moduleUrl(source.replace('"@yeoun/contracts"', JSON.stringify(contracts)))
);
const event = (id, type, data = {}) =>
  `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const response = (text, bytewise = false) => {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        if (bytewise)
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        else controller.enqueue(bytes);
        controller.close();
      },
    }),
  );
};
const fastTimers = (t) => {
  const original = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn, _delay, ...args) =>
    original(fn, 0, ...args),
  );
};

test("reconnect resumes from cursor, deduplicates replay, and preserves fragmented Korean", async (t) => {
  fastTimers(t);
  const urls = [],
    states = [],
    received = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.credentials, "include");
    assert.equal(
      init.method,
      undefined,
      "reconnect must never submit a new turn",
    );
    urls.push(url);
    return urls.length === 1
      ? response(
          event(1, "phase", { name: "thinking" }) +
            event(2, "delta", { text: "안녕" }),
          true,
        )
      : response(
          event(2, "delta", { text: "안녕" }) +
            event(3, "delta", { text: "하세요" }) +
            event(4, "done"),
          true,
        );
  });
  await followTurn(
    "same-turn",
    (e) => received.push(e),
    new AbortController().signal,
    (s) => states.push(s),
  );
  assert.deepEqual(urls, [
    "/api/v1/turns/same-turn/events?after=0",
    "/api/v1/turns/same-turn/events?after=2",
  ]);
  assert.equal(
    received
      .filter((e) => e.event === "delta")
      .map((e) => e.data.text)
      .join(""),
    "안녕하세요",
  );
  assert.deepEqual(states, ["connected", "reconnecting", "connected"]);
});

test("failed terminal event stops retry and ignores subsequent data", async (t) => {
  const received = [];
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    response(
      event(1, "failed", { message: "실패" }) +
        event(2, "delta", { text: "출력하면 안 됨" }),
    ),
  );
  await followTurn(
    "failed",
    (e) => received.push(e),
    new AbortController().signal,
  );
  assert.deepEqual(
    received.map((e) => e.event),
    ["failed"],
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("permission failures are not retried", async (t) => {
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("", { status: 404 }),
  );
  await assert.rejects(
    followTurn("private", () => {}, new AbortController().signal),
    (e) => e.status === 404,
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("eight network failures leave an explicit recoverable error", async (t) => {
  fastTimers(t);
  const states = [];
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("offline");
  });
  await assert.rejects(
    followTurn(
      "pending",
      () => {},
      new AbortController().signal,
      (s) => states.push(s),
    ),
    /답변 다시 연결/,
  );
  assert.equal(fetchMock.mock.callCount(), 8);
  assert.equal(states.length, 7);
  assert.ok(states.every((s) => s === "reconnecting"));
});

test("closing during backoff cancels without another request", async (t) => {
  const abort = new AbortController();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("offline");
  });
  await assert.rejects(
    followTurn(
      "closed",
      () => assert.fail("stale event"),
      abort.signal,
      () => abort.abort(),
    ),
    (e) => e.name === "AbortError",
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("an already closed view never starts a request", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    assert.fail("stale fetch"),
  );
  await assert.rejects(
    followTurn("closed", () => {}, AbortSignal.abort()),
    (e) => e.name === "AbortError",
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("late response after cancellation never delivers events", async (t) => {
  const abort = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    abort.abort();
    return response(event(1, "delta", { text: "늦은 응답" }));
  });
  await assert.rejects(
    followTurn("closed", () => assert.fail("stale event"), abort.signal),
    (e) => e.name === "AbortError",
  );
});
