// ===== 核心类型定义 =====

/** SM-2 评分等级：1=Again, 2=Hard, 3=Good, 4=Easy */
export type Rating = 1 | 2 | 3 | 4;

/** 单张书法记忆卡片 */
export interface Card {
  id: string;
  deck_id: string;
  front_text: string; // 正面文字（从文件名提取）
  back_text: string; // 背面文字（纯文字卡片）
  image_url: string; // 本地 ObjectURL 或远程 Supabase Storage URL
  image_storage_path: string; // Supabase Storage 路径
  ease: number; // SM-2 ease factor，默认 2.5，最小 1.3
  interval: number; // 下次间隔（分钟），0 = 新卡未学
  repetitions: number; // 复习次数
  next_review: string; // ISO 8601 UTC，下次复习时刻
  last_review: string | null; // 上次复习时间
  created_at: string; // 创建时间
  updated_at: string; // 最后修改时间（同步判定字段）
  synced: boolean; // 是否已同步到 Supabase
}

/** 牌组 */
export interface Deck {
  id: string;
  name: string;
  card_count: number;
  new_count?: number;
  daily_new_card_limit: number;
  daily_review_limit: number;
  created_at: string;
  updated_at: string;
  synced: boolean;
  /** 已发布到市场的时间（null = 未发布） */
  published_at?: string | null;
  /** 封面图 */
  cover_image?: string;
  /** 文章全文（用于文章顺序学习） */
  article_text?: string;
  /** 学习模式：默认/文章顺序/随机 */
  study_mode?: 'default' | 'sequential' | 'random';
  /** 暂停学习时间（null = 未暂停） */
  paused_at?: string | null;
}

/** 单次学习会话 */
export interface StudySession {
  id: string;
  deck_id: string;
  started_at: string;
  ended_at: string | null;
  cards_studied: number;
  ratings: { again: number; hard: number; good: number; easy: number };
}

/** 每日统计 */
export interface DailyStats {
  date: string; // YYYY-MM-DD 格式
  cards_studied: number;
  new_cards_learned: number;
}

/** SM-2 算法输入 */
export interface SM2Input {
  ease: number;
  interval: number;
  repetitions: number;
}

/** SM-2 算法输出 */
export interface SM2Output {
  ease: number;
  interval: number;
  repetitions: number;
  next_review: string; // ISO 8601
}

/** 用户信息 */
export interface User {
  id: string;
  username: string;
  role: string;
}

/** 认证响应 */
export interface AuthResponse {
  token: string;
  user: User;
}

/** 系统配置（/api/auth/config 响应） */
export interface AuthConfig {
  hasUsers: boolean;
}

/** 用户设置 */
export interface UserSettings {
  dailyNewCardLimit: number; // 默认 20
  dailyReviewLimit: number; // 每日复习上限，默认 200
  darkMode: 'system' | 'light' | 'dark';
  lastSyncAt: string | null;
}

/** 市场牌组 */
export interface MarketplaceDeck {
  deck_id: string;
  name: string;
  calligrapher: string;
  dynasty: string;
  style: string; // 楷/行/草/隶/篆
  description: string;
  cover_image: string;
  source_key?: string; // ygsf:<zitieId> | shlib:<workId>（数据来源标注）
  cover_thumb?: string;
  featured: number; // 0 or 1
  card_count: number;
  is_subscribed: boolean;
  published_at: string | null;
}

/** 发布到市场的元数据 */
export interface PublishDeckData {
  calligrapher: string;
  dynasty: string;
  style: string;
  description: string;
  cover_image: string;
  featured: boolean;
}
