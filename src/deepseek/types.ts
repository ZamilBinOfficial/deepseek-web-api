/** Core boundary types shared across model resolution, sessions, and streaming. */
export type ModelType = "default" | "expert";
export type PublicModel = "deepseek-v4-flash" | "deepseek-v4-pro";

export interface ModelResolution {
  raw: string;
  modelType: ModelType;
  publicModel: PublicModel;
}

export interface MessageTurn {
  role: string;
  content: string;
}

export interface RequestBody extends Record<string, unknown> {
  model?: unknown;
  input?: unknown;
  messages?: unknown;
  stream?: unknown;
}

export interface DeepSeekAuth {
  token: string;
  cookie: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  dumped_at: string;
}

export interface DeepSeekFragment {
  type?: unknown;
  content?: unknown;
}

export interface DeepSeekSseEvent {
  event: string | null;
  data: Record<string, unknown>;
}
