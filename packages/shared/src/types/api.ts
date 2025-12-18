import type { AuthUser } from "./user.js";
import type {
  MedicalSession,
  SessionListItem,
  SessionWithTranscript,
} from "./session.js";
import type { ProcessingProgress } from "./processing.js";

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface LoginResponse {
  user: AuthUser;
}

export interface MeResponse {
  user: AuthUser;
}

export interface SessionsListResponse {
  sessions: SessionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SessionDetailResponse {
  session: SessionWithTranscript;
  videoUrl: string | null;
}

export interface CreateSessionResponse {
  session: MedicalSession;
}

export interface SessionStatusResponse {
  progress: ProcessingProgress;
}

export type SearchMatchSource = "transcript" | "title" | "summary" | "keywords" | "tags" | "clinical_indicators";

export interface SearchResult {
  sessionId: string;
  title: string | null;
  matchedText: string;
  matchSource: SearchMatchSource;
  sectionType: string | null;
  createdAt: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

export interface SessionsListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
}
