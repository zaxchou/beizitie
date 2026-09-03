import { Router, Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import multer from 'multer';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { getDb, getUploadsDir } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { cardSourceKey, deckSourceKey } from '../services/contentKeys.js';

export const importRouter = Router();

/** 生成 UUID */
function uuid(): string {
  return crypto.randomUUID();
}

/** 当前 ISO 字符串 */
function nowISO(): string {
  return new Date().toISOString();
}

function toInt(value: unknown): number {
  return Number(value ?? 0);
}

// multer：内存存储，限制 500MB
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB
}).single('file');

/** Anki 字段模型解析结果 */
interface ParsedModel {
  textFields: string[];
  imageFields: string[];
  allFieldNames: string[];
}

/**
 * 从 col.models JSON 中解析第一个模型的字段结构
 * 启发式判断：
 *   1. 模板 afmt 中 <img src="{{FieldName}}"> → 图片字段
 *   2. 字段名含 BackFile / Image / 图片 → 图片字段
 *   3. 其余字段 → 文本字段
 */
function parseModelFields(modelsJson: string): ParsedModel | null {
  try {
    const models = JSON.parse(modelsJson) as Record<string, unknown>;
    const modelKeys = Object.keys(models);
    if (modelKeys.length === 0) return null;

    const model = models[modelKeys[0]] as Record<string, unknown>;
    const flds = model.flds as Array<{ name: string; ord: number }> | undefined;
    const tmpls = model.tmpls as Array<{ afmt?: string; qfmt?: string }> | undefined;

    if (!flds || flds.length === 0) return null;

    const sortedFlds = [...flds].sort((a, b) => a.ord - b.ord);
    const allFieldNames = sortedFlds.map((f) => f.name);

    // 收集模板中 <img src="{{FieldName}}"> 引用的字段
    const imgReferencedFields = new Set<string>();
    if (tmpls) {
      const imgRegex = /<img[^>]+src="{{([^}]+)}}"/gi;
      for (const tmpl of tmpls) {
        for (const text of [tmpl.afmt || '', tmpl.qfmt || '']) {
          let match: RegExpExecArray | null;
          while ((match = imgRegex.exec(text)) !== null) {
            imgReferencedFields.add(match[1]);
          }
        }
      }
    }

    // 启发式：名称含 BackFile/Image/图片 的字段也是图片字段
    const heuristicImgFields = new Set<string>();
    for (const f of sortedFlds) {
      if (imgReferencedFields.has(f.name)) continue;
      if (/BackFile|Image|图片/i.test(f.name)) {
        heuristicImgFields.add(f.name);
      }
    }

    const textFields: string[] = [];
    const imageFields: string[] = [];

    for (const f of sortedFlds) {
      if (imgReferencedFields.has(f.name) || heuristicImgFields.has(f.name)) {
        imageFields.push(f.name);
      } else {
        textFields.push(f.name);
      }
    }

    return { textFields, imageFields, allFieldNames };
  } catch {
    return null;
  }
}

/** 安去文件名（防路径穿越） */
function safeBasename(name: string): string {
  return path.basename(name).replace(/[<>:"/\\|?*]/g, '_');
}

// ===== 预处理阶段：解析 APKG 并提取媒体文件 =====

/** 从 ZIP 中提取图片数据（异步，在事务之前完成） */
async function extractImageFromZip(
  zip: JSZip,
  mediaMap: Record<string, string>,
  filename: string,
): Promise<Buffer | null> {
  // 尝试直接用文件名
  const directFile = zip.file(filename) || zip.file(safeBasename(filename));
  if (directFile) {
    return directFile.async('nodebuffer');
  }

  // 尝试通过 media JSON 反向查询
  // Anki 的 ZIP 中文件以数字命名（如 "0"、"1"），media JSON 的 key 对应该数字
  for (const [mediaId, storedFilename] of Object.entries(mediaMap)) {
    if (storedFilename === filename || path.basename(storedFilename) === path.basename(filename)) {
      // 先尝试用 mediaId（数字）查找（标准 Anki 格式）
      const entryById = zip.file(mediaId);
      if (entryById) {
        return entryById.async('nodebuffer');
      }
      // 再尝试用存储的文件名查找（我们的导出格式）
      const entryByName = zip.file(storedFilename);
      if (entryByName) {
        return entryByName.async('nodebuffer');
      }
      break;
    }
  }

  return null;
}

/** 一张卡片预处理后的数据 */
interface PreparedCard {
  deckName: string;
  frontText: string;
  backText: string;
  imageUrl: string;
  ease: number;
  interval: number;
  repetitions: number;
  nextReview: string;
}

// POST /api/import —— 导入 APKG 文件
importRouter.post('/import', requireAdmin, (req: Request, res: Response) => {
  importUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      console.error('[import] Upload error:', uploadErr);
      if ((uploadErr as { code?: string }).code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'File too large (max 1GB)' });
      } else {
        res.status(400).json({ error: 'Upload error: ' + uploadErr.message });
      }
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded. Use field name "file".' });
      return;
    }

    const result: {
      success: boolean;
      decks: Array<{ id: string; name: string; card_count: number }>;
      errors: Array<{ type: 'parse' | 'media' | 'db'; message: string }>;
    } = {
      success: true,
      decks: [],
      errors: [],
    };

    let ankiDb: Database.Database | null = null;
    const tmpPathBase = path.join(os.tmpdir(), `_apkg_import_${uuid()}.anki2`);

    try {
      // ========== 阶段一：解压 APKG 并读取 Anki 数据 ==========
      const zipBuffer = req.file.buffer;
      const zip = await JSZip.loadAsync(zipBuffer);

      // 提取 collection.anki2
      const ankiDbFile = zip.file('collection.anki2');
      if (!ankiDbFile) {
        res.status(400).json({ error: 'Invalid APKG: missing collection.anki2' });
        return;
      }
      const ankiDbBuffer = await ankiDbFile.async('nodebuffer');

      // 读取 media JSON（可能没有图片）
      let mediaMap: Record<string, string> = {};
      const mediaFile = zip.file('media');
      if (mediaFile) {
        try {
          mediaMap = JSON.parse(await mediaFile.async('string'));
        } catch {
          result.errors.push({ type: 'parse', message: 'Failed to parse media JSON' });
        }
      }

      // 创建临时 SQLite 读取 Anki 数据
      fs.writeFileSync(tmpPathBase, ankiDbBuffer);
      ankiDb = new Database(tmpPathBase, { readonly: true });

      // 读取 col
      const colRow = ankiDb.prepare('SELECT models, decks, crt FROM col').get() as {
        models: string; decks: string; crt: number;
      } | undefined;
      if (!colRow) {
        res.status(400).json({ error: 'Invalid APKG: empty col table' });
        return;
      }

      // 解析模型
      const parsedModel = parseModelFields(colRow.models);
      if (!parsedModel) {
        result.errors.push({ type: 'parse', message: 'No valid model, using default field mapping' });
      }

      // 解析牌组
      let ankiDecks: Record<string, { name: string }> = {};
      try {
        ankiDecks = JSON.parse(colRow.decks);
      } catch {
        res.status(400).json({ error: 'Invalid APKG: failed to parse decks JSON' });
        return;
      }

      // 读取所有 notes 和 cards
      const notes = ankiDb.prepare('SELECT id, mid, flds FROM notes').all() as Array<{
        id: number; mid: number; flds: string;
      }>;

      const ankiCards = ankiDb.prepare(
        'SELECT nid, did, ord, type, queue, ivl, factor, reps, due FROM cards'
      ).all() as Array<{
        nid: number; did: number; ord: number; type: number; queue: number;
        ivl: number; factor: number; reps: number; due: number;
      }>;

      if (notes.length === 0) {
        res.status(400).json({ error: 'APKG contains no notes' });
        return;
      }

      // 构建 note 查询表
      const noteMap = new Map<number, typeof notes[0]>();
      for (const n of notes) noteMap.set(n.id, n);

      // did → 牌组名
      const deckNameByDid = new Map<number, string>();
      for (const [strId, info] of Object.entries(ankiDecks)) {
        deckNameByDid.set(parseInt(strId, 10), info.name);
      }

      // ========== 阶段二：预处理所有卡片（含异步图片提取，在事务之前完成） ==========
      const uploadsDir = getUploadsDir();
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const preparedCards: PreparedCard[] = [];
      const seenNoteIds = new Set<number>();

      for (const card of ankiCards) {
        // 只导入 ord=0
        if (card.ord !== 0) continue;

        const note = noteMap.get(card.nid);
        if (!note) continue;

        // 同一 note 只导入一次
        if (seenNoteIds.has(card.nid)) continue;
        seenNoteIds.add(card.nid);

        const deckName = deckNameByDid.get(card.did) || 'Imported Deck';
        const fieldValues = note.flds.split('\x1f');

        // 解析字段
        let frontText = '';
        let backText = '';
        let imageUrl = '';

        if (parsedModel) {
          const textValues: string[] = [];
          let imgFilename = '';

          for (let fi = 0; fi < parsedModel.allFieldNames.length; fi++) {
            const fieldName = parsedModel.allFieldNames[fi];
            const value = fieldValues[fi] || '';

            if (parsedModel.imageFields.includes(fieldName)) {
              // 只取第一个非空的图片字段值
              // 字段值可能是纯文件名（"uuid.jpg"）或含 HTML（'<img src="uuid.jpg">'）
              if (value && !imgFilename) {
                // 尝试从 <img> 标签中提取 src
                const srcMatch = value.match(/src="([^"]+)"/);
                imgFilename = srcMatch ? srcMatch[1] : value;
              }
            } else if (parsedModel.textFields.includes(fieldName)) {
              // 文本字段中也可能有 <img> 标签（如我们导出的 Back 字段含 <img src="uuid.jpg">）
              const imgRegex = /<img[^>]+src="([^"]+)"/g;
              const imgMatch = imgRegex.exec(value);
              if (imgMatch && !imgFilename) {
                imgFilename = imgMatch[1];
              }
              // 移除 <img> 标签后的纯文本
              const cleanedValue = value.replace(/<img[^>]*>/gi, '').trim();
              textValues.push(cleanedValue);
            }
          }

          frontText = textValues[0] || '';
          backText = textValues.slice(1).filter(Boolean).join('\n');

          if (imgFilename) {
            const imgData = await extractImageFromZip(zip, mediaMap, imgFilename);
            if (imgData) {
              const ext = path.extname(imgFilename) || '.jpg';
              const newFilename = `${uuid()}${ext}`;
              fs.writeFileSync(path.join(uploadsDir, newFilename), imgData);
              imageUrl = `/uploads/${newFilename}`;
            } else {
              result.errors.push({ type: 'media', message: `Image not found: ${imgFilename}` });
            }
          }
        } else {
          // 默认映射：检测字段中的 <img> 标签
          let combinedBack = '';
          let foundFirstText = false;

          for (const val of fieldValues) {
            if (!val) continue;

            // 检查是否有 <img> 引用
            const imgRegex = /<img[^>]+src="([^"]+)"/g;
            const imgMatch = imgRegex.exec(val);

            if (imgMatch && !imageUrl) {
              const imgFilename = safeBasename(imgMatch[1]);
              const imgData = await extractImageFromZip(zip, mediaMap, imgFilename);
              if (imgData) {
                const ext = path.extname(imgFilename) || '.jpg';
                const newFilename = `${uuid()}${ext}`;
                fs.writeFileSync(path.join(uploadsDir, newFilename), imgData);
                imageUrl = `/uploads/${newFilename}`;

                // 移除 <img> 标签后的纯文本
                const cleanText = val.replace(/<img[^>]*>/gi, '').trim();
                if (cleanText) combinedBack += (combinedBack ? '\n' : '') + cleanText;
              } else {
                combinedBack += (combinedBack ? '\n' : '') + val;
              }
            } else if (!foundFirstText) {
              frontText = val;
              foundFirstText = true;
            } else {
              combinedBack += (combinedBack ? '\n' : '') + val;
            }
          }

          backText = combinedBack;
          if (!backText && !imageUrl) backText = frontText;
        }

        // 转换 Anki 卡片数据
        let ease: number;
        let interval: number;
        let repetitions: number;
        let nextReview: string;

        if (card.type === 0 || card.queue === 0) {
          ease = 2.5;
          interval = 0;
          repetitions = 0;
          nextReview = nowISO();
        } else {
          ease = Math.max(1.3, Math.min(5.0, (card.factor || 2500) / 1000));
          interval = Math.max(0, (card.ivl || 0)) * 1440;
          repetitions = card.reps || 0;
          // due = days since col.crt
          const colCrtMs = colRow.crt * 1000;
          const dueMs = colCrtMs + (card.due || 0) * 86400 * 1000;
          nextReview = new Date(dueMs).toISOString();
        }

        preparedCards.push({
          deckName, frontText, backText, imageUrl,
          ease, interval, repetitions, nextReview,
        });
      }

      // ========== 阶段三：PG 事务写入数据库 ==========
      const db = getDb();
      const deckIdCache = new Map<string, string>();
      const deckSortCache = new Map<string, number>();

      const client = await db.connect();
      try {
        await client.query('BEGIN');

        for (const pc of preparedCards) {
          // 查找或创建牌组
          let deckId = deckIdCache.get(pc.deckName);
          const deckKey = deckSourceKey(pc.deckName);
          if (!deckId) {
            const { rows: existing } = await client.query(
              `SELECT id FROM decks
               WHERE user_id = $1 AND (source_key = $2 OR (source_key = '' AND name = $3))
               ORDER BY created_at ASC LIMIT 1`,
              [req.user!.userId, deckKey, pc.deckName]
            );
            if (existing.length > 0) {
              deckId = existing[0].id;
              await client.query('UPDATE decks SET source_key = $1 WHERE id = $2 AND (source_key IS NULL OR source_key = \'\')', [deckKey, deckId]);
            } else {
              deckId = uuid();
              const now = nowISO();
              await client.query(
                'INSERT INTO decks (id, name, card_count, daily_new_card_limit, daily_review_limit, created_at, updated_at, user_id, source_key) VALUES ($1, $2, 0, 20, 200, $3, $4, $5, $6)',
                [deckId, pc.deckName, now, now, req.user!.userId, deckKey]
              );
            }
            const { rows: sortRows } = await client.query('SELECT COALESCE(MAX(sort_order), 0)::int AS max_sort FROM cards WHERE deck_id = $1', [deckId]);
            deckSortCache.set(deckId, toInt(sortRows[0]?.max_sort));
            deckIdCache.set(pc.deckName, deckId);
          }

          const nextSortOrder = (deckSortCache.get(deckId) ?? 0) + 1;
          deckSortCache.set(deckId, nextSortOrder);
          const cardKey = cardSourceKey(deckKey, nextSortOrder, pc.frontText);
          const now = nowISO();
          const { rows: existingCard } = await client.query(
            'SELECT id FROM cards WHERE deck_id = $1 AND source_key = $2 LIMIT 1',
            [deckId, cardKey]
          );
          if (existingCard.length > 0) {
            await client.query(
              `UPDATE cards
               SET front_text = $1, back_text = $2, image_url = $3, ease = $4, interval = $5, repetitions = $6,
                   next_review = $7, updated_at = $8, sort_order = $9, archived_at = NULL
               WHERE id = $10`,
              [pc.frontText, pc.backText, pc.imageUrl, pc.ease, pc.interval, pc.repetitions,
                pc.nextReview, now, nextSortOrder, existingCard[0].id]
            );
          } else {
            const cardId = uuid();
            await client.query(
              `INSERT INTO cards (id, deck_id, front_text, back_text, image_url, ease, interval, repetitions,
                                  next_review, last_review, user_id, created_at, updated_at, sort_order, source_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $11, $12, $13, $14)`,
              [
                cardId, deckId,
                pc.frontText, pc.backText, pc.imageUrl,
                pc.ease, pc.interval, pc.repetitions,
                pc.nextReview, req.user!.userId, now, now,
                nextSortOrder, cardKey,
              ]
            );
          }
        }

        // 更新所有牌组的 card_count
        for (const [name, did] of deckIdCache) {
          const { rows: countRows } = await client.query('SELECT COUNT(*)::int as cnt FROM cards WHERE deck_id = $1 AND archived_at IS NULL', [did]);
          await client.query('UPDATE decks SET card_count = $1, updated_at = $2 WHERE id = $3', [countRows[0].cnt, nowISO(), did]);
        }

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      // 生成结果
      for (const [name, did] of deckIdCache) {
        const { rows: countRows } = await db.query('SELECT COUNT(*)::int as cnt FROM cards WHERE deck_id = $1', [did]);
        result.decks.push({ id: did, name, card_count: countRows[0].cnt });
      }
    } catch (err) {
      console.error('[import] Error:', err);
      result.success = false;
      result.errors.push({
        type: 'db',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (ankiDb) ankiDb.close();
      try { fs.unlinkSync(tmpPathBase); } catch { /* ignore */ }
    }

    res.json(result);
  });
});

// ---------------------------------------------------------------------------
// POST /api/import/local-backup —— 导入单文件版备份（beizitie-backup JSON）到当前登录账号
//
// 双向兼容的另一半：单文件版(GitHub Pages/IndexedDB)导出的 JSON 恢复到服务器版。
// 安全边界（见 DEPLOYMENT_SAFETY.md）：只写当前用户自己的数据
// （自建牌组、user_card_progress、user_subscriptions、daily_stats），
// 不触碰内容域，不做任何删除；匹配到公共牌组时进度挂到共享卡片上。
// ---------------------------------------------------------------------------

interface LocalBackupDeck {
  id: string;
  name: string;
  zitieId?: string;
  calligrapher?: string;
  dynasty?: string;
  style?: string;
  created_at?: string;
  settings?: { dailyNewLimit?: number; dailyReviewLimit?: number; paused?: boolean };
}

interface LocalBackupCard {
  id: string;
  deck_id: string;
  front_text: string;
  image_url: string;
  sort_order?: number;
}

interface LocalBackupProgress {
  card_id: string;
  deck_id: string;
  ease?: number;
  interval?: number;
  repetitions?: number;
  next_review?: string;
  last_review?: string | null;
}

/** URL 归一化：去掉缩略图 query（?x-bce-process=...），用于跨版本卡片对齐 */
function normalizeImageUrl(u: string | undefined | null): string {
  return (u || '').split('?')[0].trim();
}

// 注意：importRouter 挂载在 app.use('/api') 下，APKG 导入是 '/import'，
// 这里必须带 /import 前缀，否则落不到本路由、被后面的 adminRouter.use(requireAdmin) 拦成 403
importRouter.post('/import/local-backup', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      format?: string;
      decks?: LocalBackupDeck[];
      cards?: LocalBackupCard[];
      progress?: LocalBackupProgress[];
      stats?: Array<{ date: string; studied?: number; newLearned?: number }>;
    };
    if (!body || (body.format !== 'beizitie-backup' && body.format !== 'beizitie-export')) {
      res.status(400).json({ error: '不是背字帖的备份文件' });
      return;
    }
    const userId = req.user!.userId;
    const db = getDb();
    const report = {
      decks_matched: 0,
      decks_created: 0,
      cards_created: 0,
      subscribed: 0,
      progress_imported: 0,
      progress_skipped: 0,
      stats_days: 0,
    };
    const cardIdMap = new Map<string, string>(); // 备份 card_id → 服务器 card_id

    for (const d of body.decks || []) {
      if (!d?.id || !d?.name) continue;

      // 1) zitieId → 服务器公共牌组（source_key 约定 ygsf:<zitieId>）
      let serverDeckId: string | null = null;
      let isPublicDeck = false;
      if (d.zitieId) {
        const { rows } = await db.query(
          `SELECT d.id AS id, d.user_id AS user_id,
                  EXISTS (SELECT 1 FROM marketplace_decks m WHERE m.deck_id = d.id) AS published
           FROM decks d WHERE d.source_key = $1 ORDER BY d.created_at ASC LIMIT 1`,
          [`ygsf:${d.zitieId}`]
        );
        if (rows[0]) {
          serverDeckId = rows[0].id as string;
          // 已发布到市场的帖按公共帖处理（无论挂在哪个账号名下），进度落点 + 自动补订阅
          isPublicDeck = !rows[0].user_id || rows[0].published;
        }
      }

      // 2) 用户已有同名自建牌组 → 视为同一份（重复导入幂等）
      if (!serverDeckId) {
        const { rows } = await db.query(
          `SELECT id FROM decks WHERE name = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT 1`,
          [d.name, userId]
        );
        if (rows[0]) serverDeckId = rows[0].id as string;
      }

      const deckCards = (body.cards || []).filter((c) => c.deck_id === d.id);

      if (serverDeckId) {
        report.decks_matched++;
        // 建立备份卡片 → 服务器卡片映射：先按归一化 image_url 精确对齐，
        // 再按 front_text 唯一性兜底（同一帖内同字多 variants 不能瞎匹配）
        const { rows: srvCards } = await db.query(
          `SELECT id, front_text, image_url FROM cards WHERE deck_id = $1`,
          [serverDeckId]
        );
        const byUrl = new Map<string, string>();
        const byText = new Map<string, string[]>();
        for (const sc of srvCards as Array<{ id: string; front_text: string; image_url: string }>) {
          const u = normalizeImageUrl(sc.image_url);
          if (u && !byUrl.has(u)) byUrl.set(u, sc.id);
          const arr = byText.get(sc.front_text) || [];
          arr.push(sc.id);
          byText.set(sc.front_text, arr);
        }
        for (const c of deckCards) {
          let target = byUrl.get(normalizeImageUrl(c.image_url));
          if (!target) {
            const arr = byText.get(c.front_text);
            if (arr && arr.length === 1) target = arr[0];
          }
          if (target) cardIdMap.set(c.id, target);
        }
        // 公共牌组自动补订阅，进度才有落点
        if (isPublicDeck) {
          const r = await db.query(
            `INSERT INTO user_subscriptions (user_id, deck_id, subscribed_at)
             VALUES ($1, $2, $3) ON CONFLICT (user_id, deck_id) DO NOTHING`,
            [userId, serverDeckId, new Date().toISOString()]
          );
          report.subscribed += r.rowCount || 0;
        }
      } else {
        // 没有可匹配的服务器牌组（自建帖/已下架帖）→ 在用户名下重建整帖
        const newDeckId = crypto.randomUUID();
        const now = new Date().toISOString();
        await db.query(
          `INSERT INTO decks (id, name, card_count, daily_new_card_limit, daily_review_limit, user_id, created_at, updated_at, source_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)`,
          [
            newDeckId,
            d.name,
            deckCards.length,
            d.settings?.dailyNewLimit ?? 20,
            d.settings?.dailyReviewLimit ?? 200,
            userId,
            d.created_at || now,
            `local-backup:${d.zitieId || d.id}`,
          ]
        );
        report.decks_created++;
        const CHUNK = 500;
        for (let i = 0; i < deckCards.length; i += CHUNK) {
          const chunk = deckCards.slice(i, i + CHUNK);
          const values: unknown[] = [];
          const placeholders = chunk
            .map((c, j) => {
              const b = j * 9;
              const newCardId = crypto.randomUUID();
              cardIdMap.set(c.id, newCardId);
              values.push(
                newCardId,
                newDeckId,
                c.front_text || '',
                c.image_url || '',
                now,
                now,
                now,
                c.sort_order ?? j,
                `local-backup-card:${c.id}`
              );
              return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
            })
            .join(',');
          await db.query(
            `INSERT INTO cards (id, deck_id, front_text, image_url, next_review, created_at, updated_at, sort_order, source_key)
             VALUES ${placeholders}`,
            values
          );
        }
        report.cards_created += deckCards.length;
      }
    }

    // 进度：批量 upsert（恢复语义：备份快照覆盖服务器现有进度）
    const progress = (body.progress || []).filter((p) => cardIdMap.has(p.card_id) && p.next_review);
    report.progress_skipped = (body.progress || []).length - progress.length;
    const PCHUNK = 400;
    for (let i = 0; i < progress.length; i += PCHUNK) {
      const chunk = progress.slice(i, i + PCHUNK);
      const values: unknown[] = [];
      const placeholders = chunk
        .map((p, j) => {
          const b = j * 7;
          values.push(
            userId,
            cardIdMap.get(p.card_id),
            p.ease ?? 2.5,
            p.interval ?? 0,
            p.repetitions ?? 0,
            p.next_review,
            p.last_review ?? null
          );
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
        })
        .join(',');
      await db.query(
        `INSERT INTO user_card_progress (user_id, card_id, ease, interval, repetitions, next_review, last_review)
         VALUES ${placeholders}
         ON CONFLICT (user_id, card_id) DO UPDATE SET
           ease = EXCLUDED.ease,
           interval = EXCLUDED.interval,
           repetitions = EXCLUDED.repetitions,
           next_review = EXCLUDED.next_review,
           last_review = EXCLUDED.last_review`,
        values
      );
      report.progress_imported += chunk.length;
    }

    // 每日统计：按天取较大值（统计是展示域，取 max 即可，不做加减）
    const stats = (body.stats || []).filter((s) => s?.date);
    for (const s of stats) {
      await db.query(
        `INSERT INTO daily_stats (date, user_id, deck_id, cards_studied, new_cards_learned)
         VALUES ($1, $2, '', $3, $4)
         ON CONFLICT (date, user_id, deck_id) DO UPDATE SET
           cards_studied = GREATEST(daily_stats.cards_studied, EXCLUDED.cards_studied),
           new_cards_learned = GREATEST(daily_stats.new_cards_learned, EXCLUDED.new_cards_learned)`,
        [s.date, userId, s.studied ?? 0, s.newLearned ?? 0]
      );
      report.stats_days++;
    }

    console.log(`[import] local-backup user=${userId}:`, report);
    res.json({ success: true, report });
  } catch (err) {
    console.error('[import] local-backup error:', err);
    res.status(500).json({ error: '导入失败: ' + (err instanceof Error ? err.message : String(err)) });
  }
});
