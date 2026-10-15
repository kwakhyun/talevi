import {
  createApi,
  parseSseBlock,
  ApiError,
  type StreamItem,
} from "@yeoun/contracts";
export const api = createApi("/api");

// A sleeping free host can return HTML/502 while it starts. Only retry this
// read-only probe; never automatically replay a payment or a chat submission.
export async function waitForApi(signal: AbortSignal) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const res = await fetch("/api/health", {
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(Math.min(15_000, deadline - Date.now())),
        ]),
        cache: "no-store",
      });
      if ([401, 403, 404].includes(res.status))
        throw new ApiError(res.status, "서비스 연결 설정을 확인하고 있어요.");
      if (
        res.ok &&
        res.headers.get("content-type")?.includes("application/json")
      ) {
        const health = await res.json();
        if (health.ok === true) return health as { ok: true; mode: string };
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ApiError) throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(signal.reason);
      };
      const timer = setTimeout(
        () => {
          signal.removeEventListener("abort", abort);
          resolve();
        },
        Math.min(3000, Math.max(0, deadline - Date.now())),
      );
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw new Error("연결이 지연되고 있어요. 잠시 후 다시 불러와 주세요.");
}

export async function followTurn(
  id: string,
  onEvent: (item: StreamItem) => void,
  signal: AbortSignal,
  onConnection?: (state: "connected" | "reconnecting") => void,
) {
  let cursor = 0,
    terminal = false;
  for (let attempt = 0; attempt < 8 && !terminal; attempt++) {
    signal.throwIfAborted();
    try {
      const res = await fetch(`/api/v1/turns/${id}/events?after=${cursor}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok || !res.body)
        throw new ApiError(
          res.status,
          "답변에 다시 연결하지 못했어요. 대화를 다시 열어 주세요.",
        );
      signal.throwIfAborted();
      onConnection?.("connected");
      const reader = res.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const item = parseSseBlock(block);
            if (item && item.id > cursor) {
              signal.throwIfAborted();
              cursor = item.id;
              onEvent(item);
              terminal = ["done", "failed"].includes(item.event);
              if (terminal) break;
            }
          }
          if (done || terminal) break;
        }
      } finally {
        await reader.cancel();
      }
      if (terminal) return;
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status))
        throw error;
    }
    if (attempt === 7) break;
    onConnection?.("reconnecting");
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(
        () => {
          signal.removeEventListener("abort", abort);
          resolve();
        },
        Math.min(500 * 2 ** attempt, 4000),
      );
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  if (!terminal)
    throw new Error(
      "연결이 끊겼어요. ‘답변 다시 연결’로 저장된 답변을 불러올 수 있어요.",
    );
}
