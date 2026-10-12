export type Character = {
  id: string;
  name: string;
  age: number;
  gender: string;
  art_style: "반실사" | "애니메이션";
  role: string;
  genre: string;
  tags: string[];
  color: string;
  image: string;
  headline: string;
  description: string;
  opening: string;
  appearance: Record<string, string>;
  starters: string[];
};
export type User = {
  id: string;
  nickname: string;
  email: string | null;
  credits: number;
  locale: string;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  created: number;
  turn_id: string | null;
};
export type Memory = {
  id: string;
  key: string;
  value: string;
  source_id: string | null;
  locked: boolean;
  updated: number;
};
export type Relationship = {
  trust: number;
  shared: number;
  stage: string;
  warmth?: number;
  tension?: number;
  meaningful_turns?: number;
  last_change?: { reason: string; evidence: string; delta: number };
  changes?: { reason: string; evidence: string; delta: number }[];
};
export type StoryRecord = {
  key: string;
  value: string;
  evidence: string;
  source: "user" | "reply";
  source_id: string | null;
  status: "active" | "resolved";
};
export type Conversation = {
  id: string;
  character_id: string;
  messages: Message[];
  memories: Memory[];
  settings: {
    memory_enabled: boolean;
    pace: "slow" | "natural";
    length: "short" | "balanced" | "long";
  };
  relationship: Relationship;
  narrative: {
    chapter: number;
    beat: number;
    last_event: string | null;
    story_slots?: Record<string, StoryRecord>;
    developments?: StoryRecord[];
    episode_notes?: {
      source_id: string;
      quote: string;
      role: string;
      created: number;
    }[];
  };
  active_turn: string | null;
};
export type ConversationSummary = Pick<
  Conversation,
  "id" | "character_id" | "relationship"
> & { updated: number };
export type StreamItem = {
  id: number;
  event: string;
  data: Record<string, unknown>;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function createApi(
  base: string,
  token: () => Promise<string | null> = async () => null,
) {
  return async function api<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const bearer = await token();
    const res = await fetch(base + path, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Yeoun-Client": "1",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) {
      let message = "연결이 잠시 끊겼어요. 다시 시도해 주세요.";
      try {
        const body = await res.json();
        if (typeof body.detail === "string") message = body.detail;
      } catch {}
      throw new ApiError(res.status, message);
    }
    return res.json();
  };
}
export function parseSseBlock(block: string): StreamItem | null {
  let id = 0,
    event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("id:")) id = Number(line.slice(3).trim());
    else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  return { id, event, data: JSON.parse(data.join("\n")) };
}
export const ko = {
  brand: "테일비",
  discover: "탐색",
  conversations: "나의 대화",
  bookmarks: "책갈피",
  create: "캐릭터 만들기",
  memory: "기억 노트",
  relationship: "우리 사이",
  send: "보내기",
  search: "캐릭터, 취향, 이야기를 검색하세요",
  start: "첫 대화 시작하기",
  retry: "다시 시도",
  aiNotice: "캐릭터의 답변은 AI가 만들어요.",
  billingUnit: "빛",
} as const;
export type Locale = "ko-KR";
export const supportedLocales: Locale[] = ["ko-KR"];
export const dictionaries: Record<Locale, typeof ko> = { "ko-KR": ko };
