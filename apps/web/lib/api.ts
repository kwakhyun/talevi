import {
  createApi,
  parseSseBlock,
  ApiError,
  type StreamItem,
} from "@yeoun/contracts";
export const api = createApi("/api");
export async function followTurn(
  id: string,
  onEvent: (item: StreamItem) => void,
  signal: AbortSignal,
) {
  let cursor = 0,
    terminal = false;
  for (let attempt = 0; attempt < 8 && !terminal; attempt++) {
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
              cursor = item.id;
              onEvent(item);
              terminal = ["done", "failed"].includes(item.event);
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
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
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
      "연결이 끊겼어요. 다시 열면 저장된 답변을 불러올 수 있어요.",
    );
}
