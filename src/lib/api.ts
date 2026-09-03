// ===== Express API 客户端 =====

import type { Card, Deck, StudySession, DailyStats, MarketplaceDeck, PublishDeckData, AuthResponse } from '@/types';
import { useAuthStore } from '@/stores/useAuthStore';

const API_BASE = '';

/** 获取本地日期字符串 YYYY-MM-DD（不受 UTC 时区偏移影响） */
export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 将服务端图片路径转为完整 URL（用于 <img src> 显示） */
export function getImageUrl(imageUrl: string): string {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  return `${API_BASE}${imageUrl}`;
}

// ===== 通用 fetch 封装 =====

/**
 * 处理 401（令牌失效/过期）：登出并跳转登录页。
 * 返回一个可供调用方 throw 或 reject 的 Error，统一三处 fetch/xhr 入口的行为。
 */
function handleUnauthorized(): Error {
  useAuthStore.getState().logout();
  window.location.href = '/login';
  return new Error('认证已过期，请重新登录');
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  // 自动携带认证 token
  const { token } = useAuthStore.getState();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...options?.headers as Record<string, string> };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${url}`, {
    headers,
    ...options,
  });

  if (res.status === 401) {
    throw handleUnauthorized();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: string }).error || res.statusText;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ===== 牌组 API =====

export function fetchDecks(subscribedOnly?: boolean): Promise<Deck[]> {
  const qs = subscribedOnly ? '?subscribed=1' : '';
  return request<Deck[]>(`/api/decks${qs}`);
}

export function createDeck(name: string): Promise<Deck> {
  return request<Deck>('/api/decks', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function renameDeck(id: string, name: string): Promise<Deck> {
  return request<Deck>(`/api/decks/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export function deleteDeckApi(id: string): Promise<{ success: boolean }> {
  return request(`/api/decks/${id}`, { method: 'DELETE' });
}

export function resetDeckProgress(id: string): Promise<{ success: boolean; reset_count: number }> {
  return request(`/api/decks/${id}/reset-progress`, { method: 'PUT' });
}

export function forceResetDeckProgress(id: string): Promise<{ success: boolean; reset_count: number }> {
  return request(`/api/decks/${id}/reset-progress?force=1`, { method: 'PUT' });
}

export function updateDeckName(id: string, name: string): Promise<Deck> {
  return request<Deck>(`/api/decks/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export function updateDeckLimits(
  id: string,
  limits: { daily_new_card_limit?: number; daily_review_limit?: number }
): Promise<Deck> {
  return request(`/api/decks/${id}/limits`, {
    method: 'PUT',
    body: JSON.stringify(limits),
  });
}

export function updateCardCountApi(
  deckId: string,
  count: number
): Promise<Deck> {
  return request<Deck>(`/api/decks/${deckId}/card-count`, {
    method: 'PUT',
    body: JSON.stringify({ count }),
  });
}

/** 设置牌组学习模式 */
export function updateStudyMode(
  deckId: string,
  mode: 'default' | 'sequential' | 'random'
): Promise<{ success: boolean }> {
  return request(`/api/decks/${deckId}/study-mode`, {
    method: 'PUT',
    body: JSON.stringify({ study_mode: mode }),
  });
}

/** 记录自己的 SM-2 学习进度（写到 user_card_progress） */
export function updateCardProgress(
  cardId: string,
  progress: { ease?: number; interval?: number; repetitions?: number; next_review?: string; last_review?: string }
): Promise<{ success: boolean }> {
  return request(`/api/cards/${cardId}/progress`, {
    method: 'PUT',
    body: JSON.stringify(progress),
  });
}

/** 暂停/恢复牌组学习 */
export function toggleDeckPause(
  deckId: string,
  paused: boolean
): Promise<{ success: boolean; paused_at: string | null }> {
  return request(`/api/decks/${deckId}/pause`, {
    method: 'PUT',
    body: JSON.stringify({ paused }),
  });
}

/** 检查牌组是否有学习记录 */
export function hasStudiedDeck(deckId: string): Promise<{ has_studied: boolean }> {
  return request(`/api/decks/${deckId}/has-studied`);
}

/** 设置牌组文章全文并计算卡片 sort_order（admin only） */
export function setArticleText(
  deckId: string,
  articleText: string
): Promise<{ matched: number; unmatched: number; total_cards: number }> {
  return request(`/api/decks/${deckId}/set-article-text`, {
    method: 'POST',
    body: JSON.stringify({ article_text: articleText }),
  });
}

// ===== 卡片 API =====

export function fetchCards(deckId: string): Promise<Card[]> {
  return request<Card[]>(`/api/decks/${deckId}/cards`);
}

export interface CardPreview {
  front_text: string;
  image_url: string;
}

/** 获取牌组卡片预览（公开，无需登录） */
export function fetchDeckCardPreviews(deckId: string): Promise<{ cards: CardPreview[] }> {
  return request<{ cards: CardPreview[] }>(`/api/decks/${deckId}/cards/preview`);
}

export function createCard(
  deckId: string,
  frontText: string,
  imageBase64?: string,
  backText?: string
): Promise<Card> {
  return request<Card>(`/api/decks/${deckId}/cards`, {
    method: 'POST',
    body: JSON.stringify({
      front_text: frontText,
      image_url: imageBase64 || '',
      back_text: backText || '',
    }),
  });
}

export function batchImportCards(
  deckId: string,
  files: File[]
): Promise<{ created: number; cards: Card[] }> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('images', file);
  }
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(`${API_BASE}/api/decks/${deckId}/cards/batch`, {
    method: 'POST',
    body: formData,
    headers,
  }).then((res) => {
    if (res.status === 401) {
      throw handleUnauthorized();
    }
    if (!res.ok) {
      return res.json().then((body) => {
        throw new Error((body as { error?: string }).error || res.statusText);
      });
    }
    return res.json();
  });
}

export function batchImportText(
  deckId: string,
  text: string
): Promise<{ created: number; cards: Array<{ front: string; back: string }> }> {
  return request(`/api/decks/${deckId}/cards/batch-text`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export function updateCard(
  id: string,
  fields: Partial<Pick<Card, 'front_text' | 'image_url' | 'ease' | 'interval' | 'repetitions' | 'next_review' | 'last_review'>>
): Promise<Card> {
  return request<Card>(`/api/cards/${id}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  });
}

export function deleteCardApi(id: string): Promise<{ success: boolean }> {
  return request(`/api/cards/${id}`, { method: 'DELETE' });
}

export function fetchDueCards(
  deckId: string,
  limit?: number,
  mode?: 'default' | 'sequential' | 'random'
): Promise<Card[]> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (mode) params.set('mode', mode);
  const qs = params.toString();
  return request<Card[]>(`/api/decks/${deckId}/due-cards${qs ? `?${qs}` : ''}`);
}

export function fetchNewCards(
  deckId: string,
  limit?: number,
  mode?: 'default' | 'sequential' | 'random'
): Promise<Card[]> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (mode) params.set('mode', mode);
  const qs = params.toString();
  return request<Card[]>(`/api/decks/${deckId}/new-cards${qs ? `?${qs}` : ''}`);
}

// ===== 学习会话 API =====

export function createStudySession(
  deckId: string,
  startedAt?: string
): Promise<StudySession> {
  return request<StudySession>('/api/study-sessions', {
    method: 'POST',
    body: JSON.stringify({
      deck_id: deckId,
      started_at: startedAt,
    }),
  });
}

export function endStudySession(
  id: string,
  data: {
    ended_at?: string;
    cards_studied?: number;
    ratings?: { again?: number; hard?: number; good?: number; easy?: number };
  }
): Promise<StudySession> {
  return request<StudySession>(`/api/study-sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ===== 每日统计 API =====

export function fetchDailyStats(date: string, deckId?: string): Promise<DailyStats> {
  const params = deckId ? `?deck_id=${encodeURIComponent(deckId)}` : '';
  return request<DailyStats>(`/api/daily-stats/${date}${params}`);
}

export function upsertDailyStats(
  date: string,
  data: { deck_id?: string; cards_studied?: number; new_cards_learned?: number }
): Promise<DailyStats> {
  return request<DailyStats>(`/api/daily-stats/${date}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** 原子增量更新每日统计（SQL 端累加，避免读后写竞态） */
export function incrementDailyStats(
  date: string,
  data: { deck_id?: string; cards_studied?: number; new_cards_learned?: number }
): Promise<DailyStats> {
  return request<DailyStats>(`/api/daily-stats/${date}/increment`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** 获取日期范围内的每日统计（用于计算打卡天数） */
export function fetchDailyStatsRange(
  from: string,
  to: string
): Promise<{ date: string; cards_studied: number; new_cards_learned: number }[]> {
  return request(`/api/daily-stats/range?from=${from}&to=${to}`);
}

/** 获取所有牌组的到期卡片计数 */
export function fetchDueCounts(): Promise<
  { id: string; name: string; due_count: number }[]
> {
  return request('/api/due-counts');
}

// ===== 数据分析 API =====

export interface CardStatus {
  new: number;
  learning: number;
  young: number;
  mature: number;
}

export function fetchCardStatus(deckId: string): Promise<CardStatus> {
  return request(`/api/analytics/${deckId}/card-status`);
}

export interface Difficulty {
  hard: number;
  medium: number;
  easy: number;
  unreviewed: number;
}

export function fetchDifficulty(deckId: string): Promise<Difficulty> {
  return request(`/api/analytics/${deckId}/difficulty`);
}

export interface RatingsSummary {
  again: number;
  hard: number;
  good: number;
  easy: number;
  total: number;
}

export function fetchRatingsSummary(deckId: string): Promise<RatingsSummary> {
  return request(`/api/analytics/${deckId}/ratings`);
}

export interface DailyTrendPoint {
  date: string;
  cards_studied: number;
  new_cards_learned: number;
}

export function fetchDailyTrend(days?: number): Promise<DailyTrendPoint[]> {
  return request(`/api/analytics/daily-trend${days ? `?days=${days}` : ''}`);
}

/** 每日扩展统计（新学/复习/评分分布/学时），用于 AnalyticsPage 三图表 */
export interface DailyExtraPoint {
  date: string;
  new_learned: number;
  reviewed: number;
  hard: number;
  medium: number;
  easy: number;
  minutes: number;
}

export function fetchDailyExtra(
  days?: number,
  opts?: { from?: string; to?: string; deckId?: string }
): Promise<DailyExtraPoint[]> {
  const params = new URLSearchParams();
  if (opts?.from && opts?.to) {
    params.set('from', opts.from);
    params.set('to', opts.to);
  } else if (days) {
    params.set('days', String(days));
  }
  if (opts?.deckId) params.set('deckId', opts.deckId);
  const qs = params.toString();
  return request(`/api/analytics/daily-extra${qs ? `?${qs}` : ''}`);
}

/** 累计学习总时长与总会话数 */
export interface StudyTotal {
  total_sessions: number;
  total_minutes: number;
}
export function fetchStudyTotal(): Promise<StudyTotal> {
  return request('/api/study-sessions/total');
}

// ===== APKG 导入/导出 API =====

/** 导入结果类型 */
export interface ImportResult {
  success: boolean;
  decks: Array<{ id: string; name: string; card_count: number }>;
  errors: Array<{ type: 'parse' | 'media' | 'db'; message: string }>;
}

/** 导出安全内容包（触发浏览器下载） */
export function exportContentPackage(deckId: string, deckName: string): void {
  const token = useAuthStore.getState().token;
  fetch(`${API_BASE}/api/admin/content/package/${deckId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then((res) => {
    if (res.status === 401) throw handleUnauthorized();
    if (!res.ok) {
      return res.json().then((body) => {
        throw new Error((body as { error?: string }).error || res.statusText);
      });
    }
    return res.blob();
  }).then((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deckName}.content.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }).catch((err) => {
    alert(err instanceof Error ? err.message : '导出内容包失败');
  });
}

export function exportDeck(deckId: string, deckName: string): void {
  const safeName = deckName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
  const a = document.createElement('a');
  a.href = `${API_BASE}/api/export/${encodeURIComponent(deckId)}`;
  a.download = `${safeName}.apkg`;
  a.click();
}

/** 导出全部牌组为 APKG */
export function exportAllDecks(): void {
  const a = document.createElement('a');
  a.href = `${API_BASE}/api/export`;
  a.download = 'all_decks.apkg';
  a.click();
}

/** 导入 APKG 文件 */
/** 导入 APKG 文件（支持进度回调） */
export async function importApkgFile(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);

  const token = useAuthStore.getState().token;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 401) {
        reject(handleUnauthorized());
        return;
      }
      const contentType = xhr.getResponseHeader('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('解析响应失败'));
        }
      } else {
        reject(new Error(`上传失败 (HTTP ${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.onabort = () => reject(new Error('上传已取消'));

    xhr.open('POST', `${API_BASE}/api/import`);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.send(formData);
  });
}

// ===== 生产环境功能开关 =====

export interface ProductionFeatures {
  guestMode: boolean;
  filing: { icp?: string; psb?: string } | null;
}

/** 获取生产环境功能开关（本地开发返回默认值） */
export function fetchProductionFeatures(): Promise<ProductionFeatures> {
  return request<ProductionFeatures>('/api/auth/production-features');
}

/** 游客登录（仅生产环境可用） */
export function guestLogin(): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/guest', { method: 'POST' });
}

/** 修改密码 */
export function changePassword(oldPassword: string, newPassword: string): Promise<{ success: boolean }> {
  return request('/api/auth/password', {
    method: 'PUT',
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}

// ===== 市场 API =====

/** 浏览市场牌组（可按书体/书家/关键词筛选） */
export function fetchMarketplaceDecks(params?: {
  style?: string;
  calligrapher?: string;
  search?: string;
}): Promise<MarketplaceDeck[]> {
  const qs = new URLSearchParams();
  if (params?.style) qs.set('style', params.style);
  if (params?.calligrapher) qs.set('calligrapher', params.calligrapher);
  if (params?.search) qs.set('search', params.search);
  const q = qs.toString();
  return request<MarketplaceDeck[]>(`/api/marketplace/decks${q ? `?${q}` : ''}`);
}

/** 分页浏览市场牌组（大目录用，带总数与书家 facets） */
export function fetchMarketplaceDecksPaged(params: {
  style?: string;
  calligrapher?: string;
  search?: string;
  limit: number;
  offset: number;
}): Promise<{ total: number; calligraphers: string[]; decks: MarketplaceDeck[] }> {
  const qs = new URLSearchParams();
  if (params.style) qs.set('style', params.style);
  if (params.calligrapher) qs.set('calligrapher', params.calligrapher);
  if (params.search) qs.set('search', params.search);
  qs.set('limit', String(params.limit));
  qs.set('offset', String(params.offset));
  return request(`/api/marketplace/decks?${qs.toString()}`);
}

/** 获取单个市场牌组详情 */
export function fetchMarketplaceDeck(deckId: string): Promise<MarketplaceDeck> {
  return request<MarketplaceDeck>(`/api/marketplace/decks/${deckId}`);
}

/** 订阅牌组 */
export function subscribeDeck(deckId: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/marketplace/decks/${deckId}/subscribe`, {
    method: 'POST',
  });
}

/** 退订牌组 */
export function unsubscribeDeck(deckId: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/marketplace/decks/${deckId}/subscribe`, {
    method: 'DELETE',
  });
}

/** 获取当前用户已订阅的市场牌组 */
export function fetchSubscriptions(): Promise<MarketplaceDeck[]> {
  return request<MarketplaceDeck[]>('/api/marketplace/subscriptions');
}

/** Admin：发布牌组到市场 */
export function publishDeck(deckId: string, data: PublishDeckData): Promise<MarketplaceDeck> {
  return request<MarketplaceDeck>(`/api/marketplace/decks/${deckId}/publish`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** Admin：更新市场牌组元数据 */
export function updateMarketplaceDeck(
  deckId: string,
  data: Partial<PublishDeckData>
): Promise<MarketplaceDeck> {
  return request<MarketplaceDeck>(`/api/marketplace/decks/${deckId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** Admin：下架市场牌组 */
export function unpublishDeck(deckId: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/marketplace/decks/${deckId}/publish`, {
    method: 'DELETE',
  });
}

// ===== 集字 API =====

import type { JiziMatchResponse } from '@/types/jizi';

/** 集字匹配：输入文字，返回每个字对应的卡片图片列表 */
export function fetchJiziMatch(text: string, scope: 'mine' | 'all' = 'mine'): Promise<JiziMatchResponse> {
  const qs = new URLSearchParams({ text, scope });
  return request<JiziMatchResponse>(`/api/jizi/match?${qs}`);
}

/** 搜索历史条目 */
export interface JiziHistoryItem {
  id: string;
  text: string;
  created_at: string;
}

/** 获取集字搜索历史（需要登录） */
export function fetchJiziHistory(): Promise<{ items: JiziHistoryItem[] }> {
  return request<{ items: JiziHistoryItem[] }>('/api/jizi/history');
}

/** 保存集字搜索记录（需要登录） */
export function saveJiziHistory(text: string): Promise<{ saved: boolean; id?: string; created_at?: string; reason?: string }> {
  return request('/api/jizi/history', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

/** 删除一条集字搜索记录 */
export function deleteJiziHistory(id: string): Promise<{ success: boolean }> {
  return request(`/api/jizi/history/${id}`, { method: 'DELETE' });
}

// ===== 字帖元数据管理 API (Admin) =====

/** 上传市场牌组封面图 */
export function uploadMarketCover(deckId: string, file: File): Promise<{ success: true; cover_image: string }> {
  const formData = new FormData();
  formData.append('cover', file);
  const token = useAuthStore.getState().token;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/marketplace/decks/${deckId}/cover`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // 不设置 Content-Type，让浏览器自动设置 multipart boundary

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('解析失败')); }
      } else {
        const msg = `上传失败 (HTTP ${xhr.status})`;
        console.error('[uploadMarketCover]', msg, xhr.responseText?.substring(0,200));
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new Error(body.error || msg));
        } catch {
          reject(new Error(msg));
        }
      }
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.send(formData);
  });
}

/** 更新市场牌组元数据 */
export function updateMarketDeck(deckId: string, data: {
  calligrapher?: string;
  dynasty?: string;
  style?: string;
  description?: string;
  featured?: number;
  cover_image?: string;
}): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/api/marketplace/decks/${deckId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ===== 管理员用户管理 API =====

export interface AdminUser {
  id: string;
  username: string;
  role: string;
  created_at: string;
}

export function fetchAdminUsers(): Promise<AdminUser[]> {
  return request<AdminUser[]>('/api/admin/users');
}

export function updateAdminUser(id: string, data: { username?: string; password?: string }): Promise<{ success: boolean }> {
  return request(`/api/admin/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteAdminUser(id: string): Promise<{ success: boolean }> {
  return request(`/api/admin/users/${id}`, { method: 'DELETE' });
}

export interface UserStatsResponse {
  user: { id: string; username: string };
  stats: {
    total_studied: number;
    active_days: number;
    total_new_learned: number;
    total_sessions: number;
    total_minutes: number;
    cards: { new_count: number; learning_count: number; mature_count: number };
  };
  daily_stats: { date: string; cards_studied: number; new_cards_learned: number }[];
  subscriptions: { id: string; name: string }[];
}

export function fetchUserStats(userId: string): Promise<UserStatsResponse> {
  return request<UserStatsResponse>(`/api/admin/users/${userId}/stats`);
}

export interface AdminDashboardResponse {
  fetched_at: string;
  users: {
    total: number;
    admins: number;
    normal: number;
    new_today: number;
    new_7d: number;
    new_30d: number;
    latest_registered_at: string | null;
  };
  activity: {
    dau_today: number;
    active_7d: number;
    mau_30d: number;
    study_active_today: number;
    jizi_active_today: number;
    total_study_sessions: number;
    total_cards_studied: number;
    total_jizi_requests: number;
    latest_study_at: string | null;
    latest_jizi_at: string | null;
    latest_daily_stat_date: string | null;
  };
  content: {
    decks: number;
    cards: number;
    marketplace_decks: number;
    featured_decks: number;
    cards_with_image: number;
    upload_files: number;
    latest_deck_updated_at: string | null;
    latest_card_created_at: string | null;
  };
  health: {
    empty_decks: number;
    users_never_studied: number;
    cards_without_image: number;
    decks_card_count_mismatch: number;
  };
}

export function fetchAdminDashboard(): Promise<AdminDashboardResponse> {
  return request<AdminDashboardResponse>('/api/admin/dashboard');
}
