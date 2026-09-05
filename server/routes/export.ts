import { Router, Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { getDb, getUploadsDir } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export const exportRouter = Router();

/** 当前时间戳（秒） */
function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** 将 UUID 映射为数值（MD5 前 6 字节 → 48 位正数） */
function uuidToNumeric(uuid: string): number {
  const hash = crypto.createHash('md5').update(uuid).digest();
  // 用乘法而非 << 避免 JS 32 位有符号截断
  let result = 0;
  for (let i = 0; i < 6; i++) {
    result = result * 256 + hash[i];
  }
  // 6 字节最大 2.8e14 < Number.MAX_SAFE_INTEGER (9e15) → 安全
  return result;
}

// GET /api/export/:deckId —— 导出指定牌组为 APKG
exportRouter.get('/export/:deckId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const db = getDb();

    // 1. 获取牌组（仅当前用户的）
    const { rows: deckRows } = await db.query('SELECT * FROM decks WHERE id = $1 AND user_id = $2', [deckId, req.user!.userId]) as unknown as { rows: Record<string, unknown>[] };
    const deck = deckRows[0] as Record<string, unknown> | undefined;
    if (!deck) {
      res.status(404).json({ error: 'Deck not found' });
      return;
    }

    // 2. 获取卡片
    const { rows: cards } = await db.query(
      `SELECT id, deck_id, front_text, back_text, image_url, ease, interval, repetitions, next_review, created_at
       FROM cards WHERE deck_id = $1 ORDER BY created_at ASC`,
      [deckId]
    ) as unknown as { rows: Array<Record<string, unknown>> };

    if (cards.length === 0) {
      res.status(400).json({ error: 'Deck has no cards to export' });
      return;
    }

    // 3. 创建 APKG
    const zip = new JSZip();
    const ankiDb = new Database(':memory:');
    const now = nowUnix();
    const deckName = deck.name as string;
    const numericDeckId = uuidToNumeric(deckId as string);
    const modelId = numericDeckId + 1; // 模型 ID = 牌组 ID + 1

    // 3a. 创建 collection.anki2 表结构
    ankiDb.exec(`
      CREATE TABLE col (
        id INTEGER PRIMARY KEY,
        crt INTEGER NOT NULL,
        mod INTEGER NOT NULL,
        scm INTEGER NOT NULL,
        ver INTEGER NOT NULL,
        dty INTEGER NOT NULL,
        usn INTEGER NOT NULL,
        ls INTEGER NOT NULL,
        conf TEXT NOT NULL,
        models TEXT NOT NULL,
        decks TEXT NOT NULL,
        dconf TEXT NOT NULL,
        tags TEXT NOT NULL
      );
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY,
        guid TEXT NOT NULL,
        mid INTEGER NOT NULL,
        mod INTEGER NOT NULL,
        usn INTEGER NOT NULL,
        tags TEXT NOT NULL,
        flds TEXT NOT NULL,
        sfld TEXT NOT NULL,
        csum INTEGER NOT NULL,
        flags INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE cards (
        id INTEGER PRIMARY KEY,
        nid INTEGER NOT NULL,
        did INTEGER NOT NULL,
        ord INTEGER NOT NULL,
        mod INTEGER NOT NULL,
        usn INTEGER NOT NULL,
        type INTEGER NOT NULL,
        queue INTEGER NOT NULL,
        due INTEGER NOT NULL,
        ivl INTEGER NOT NULL,
        factor INTEGER NOT NULL,
        reps INTEGER NOT NULL,
        lapses INTEGER NOT NULL,
        left INTEGER NOT NULL,
        odue INTEGER NOT NULL,
        odid INTEGER NOT NULL,
        flags INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX ix_notes_guid ON notes (guid);
      CREATE INDEX ix_cards_nid ON cards (nid);
      CREATE INDEX ix_cards_did ON cards (did);
    `);

    // 3b. 准备 JSON 配置
    const models: Record<string, unknown> = {};
    const decksConf: Record<string, unknown> = {};

    // 模型定义（Basic + image 综合）
    models[String(modelId)] = {
      id: modelId,
      name: 'Calligraphy Card',
      type: 0,
      mod: now,
      usn: -1,
      sortf: 0,
      did: numericDeckId,
      tmpls: [{
        name: 'Card 1',
        ord: 0,
        qfmt: '{{Front}}',
        afmt: '{{Front}}<hr id=answer>{{Back}}',
        bqfmt: '',
        bafmt: '',
        did: null,
        bfont: '',
        bsize: 0,
      }],
      flds: [
        { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Noto Sans SC', size: 20, media: [] },
        { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Noto Sans SC', size: 20, media: [] },
      ],
      css: `.card {\n  font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;\n  font-size: 24px;\n  text-align: center;\n  color: #333;\n}`,
      latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
      latexPost: '\\end{document}',
      latexsvg: false,
      req: [[0, 'all', [0]]],
    };

    // 牌组定义
    decksConf[String(numericDeckId)] = {
      id: numericDeckId,
      name: deckName,
      desc: '',
      dyn: 0,
      col: '',
      usn: -1,
      mod: now,
      conf: 1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
    };

    // 3c. 插入 col 行
    const ankiEpoch = new Date(Date.UTC(2012, 4, 8));
    const colCrt = Math.floor(ankiEpoch.getTime() / 1000);
    // 最小 col.conf（Anki 配置，缺失项用默认值）
    const colConf = JSON.stringify({ curDeck: 1, activeDecks: [1] });

    ankiDb.prepare(`
      INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
      VALUES (1, ?, ?, ?, 11, 0, -1, 0, ?, ?, ?, '{}', '{}')
    `).run(
      colCrt,
      now,
      now,
      colConf,
      JSON.stringify(models),
      JSON.stringify(decksConf),
    );

    // 3d. 准备 notes 和 cards 插入语句
    const insertNote = ankiDb.prepare(`
      INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
      VALUES (?, ?, ?, ?, -1, '', ?, ?, ?, 0, '')
    `);
    const insertCard = ankiDb.prepare(`
      INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
      VALUES (?, ?, ?, 0, ?, -1, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, '')
    `);

    // 媒体文件映射：{mediaId: filename}
    const mediaMap: Record<string, string> = {};
    let mediaId = 0;

    const uploadsDir = getUploadsDir();

    // 事务：批量写入 notes 和 cards
    const writeBatch = ankiDb.transaction(() => {
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];

        // 生成 note ID 和 card ID
        const noteId = uuidToNumeric(card.id as string);
        const cardId = noteId + 1; // card ID = note ID + 1

        // guid: 取 UUID 前 8 位
        const guid = (card.id as string).replace(/-/g, '').slice(0, 8).toUpperCase();

        // 构建 flds：Front 和 Back
        let backContent = (card.back_text as string) || '';
        const imageUrl = (card.image_url as string) || '';

        if (imageUrl) {
          // 提取文件名（/uploads/uuid.jpg → uuid.jpg）
          const imgFilename = path.basename(imageUrl);
          const imgFilePath = path.join(uploadsDir, imgFilename);

          // 检查图片文件是否存在
          if (fs.existsSync(imgFilePath)) {
            // 添加到 ZIP (使用原始 UUID 文件名)
            const imgBuffer = fs.readFileSync(imgFilePath);
            zip.file(imgFilename, imgBuffer);

            // 添加到 media JSON
            mediaMap[String(mediaId)] = imgFilename;
            mediaId++;

            // Back 字段包含图片引用
            if (backContent) {
              backContent += `<br><img src="${imgFilename}">`;
            } else {
              backContent = `<img src="${imgFilename}">`;
            }
          } else {
            console.warn(`[export] Image not found: ${imgFilePath}, skipping`);
          }
        }

        // 没有图片也没有 back_text → 放文件名
        if (!backContent) {
          backContent = (card.front_text as string) || '';
        }

        const flds = `${card.front_text as string}\x1f${backContent}`;
        const sfld = card.front_text as string;

        // sfld 的简单 checksum
        let csum = 0;
        for (let j = 0; j < sfld.length; j++) {
          csum = ((csum << 5) - csum) + sfld.charCodeAt(j);
          csum &= 0xFFFFFFFF;
        }

        insertNote.run(noteId, guid, modelId, now, flds, sfld, csum);

        // 转换卡片参数
        const interval = card.interval as number;
        const repetitions = card.repetitions as number;
        const ease = card.ease as number;
        const nextReview = card.next_review as string;

        // type / queue / due / ivl
        let cardType: number, queue: number, due: number, ivl: number;

        if (interval === 0) {
          // 新卡片
          cardType = 0;
          queue = 0;
          ivl = 0;
          due = i; // 新卡按顺序
        } else {
          // 复习卡
          cardType = 2;
          queue = 2;
          // interval 分钟 → 天数
          ivl = Math.round(interval / 1440);
          if (ivl < 1) ivl = 1;

          // due: 到期日相对于 col.crt 的天数
          const nextReviewMs = new Date(nextReview).getTime();
          due = Math.max(0, Math.floor((nextReviewMs / 1000 - colCrt) / 86400));
        }

        // factor: ease × 1000
        const factor = Math.round((ease as number) * 1000);

        insertCard.run(cardId, noteId, numericDeckId, now, cardType, queue, due, ivl, factor, repetitions);
      }
    });

    writeBatch();

    // 3e. 将 in-memory SQLite 序列化为 Buffer 加入 ZIP
    const dbBuffer = ankiDb.serialize();
    ankiDb.close();
    zip.file('collection.anki2', dbBuffer);

    // 3f. 添加 media JSON
    zip.file('media', JSON.stringify(mediaMap));

    // 4. 生成 ZIP 并返回
    zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }).then((zipBuffer) => {
      const safeName = deckName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="deck.apkg"; filename*=UTF-8''${encodeURIComponent(safeName)}.apkg`);
      res.setHeader('Content-Length', zipBuffer.length);
      res.end(zipBuffer);
    }).catch((err) => {
      console.error('[export] ZIP generation error:', err);
      res.status(500).json({ error: 'Failed to generate APKG file' });
    });
  } catch (err) {
    console.error('GET /export/:deckId error:', err);
    res.status(500).json({ error: 'Failed to export deck' });
  }
});

// GET /api/export —— 导出全部牌组为 APKG
exportRouter.get('/export', requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { rows: decks } = await db.query('SELECT id, name FROM decks WHERE user_id = $1 ORDER BY created_at ASC', [req.user!.userId]) as unknown as { rows: Array<Record<string, unknown>> };

    if (decks.length === 0) {
      res.status(400).json({ error: 'No decks to export' });
      return;
    }

    // 全部牌组合并为一个 APKG
    const zip = new JSZip();
    const ankiDb = new Database(':memory:');
    const now = nowUnix();

    // 同导出单牌组，但需要遍历多个牌组
    ankiDb.exec(`
      CREATE TABLE col (
        id INTEGER PRIMARY KEY,
        crt INTEGER NOT NULL,
        mod INTEGER NOT NULL,
        scm INTEGER NOT NULL,
        ver INTEGER NOT NULL,
        dty INTEGER NOT NULL,
        usn INTEGER NOT NULL,
        ls INTEGER NOT NULL,
        conf TEXT NOT NULL,
        models TEXT NOT NULL,
        decks TEXT NOT NULL,
        dconf TEXT NOT NULL,
        tags TEXT NOT NULL
      );
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY,
        guid TEXT NOT NULL,
        mid INTEGER NOT NULL,
        mod INTEGER NOT NULL,
        usn INTEGER NOT NULL,
        tags TEXT NOT NULL,
        flds TEXT NOT NULL,
        sfld TEXT NOT NULL,
        csum INTEGER NOT NULL,
        flags INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE cards (
        id INTEGER PRIMARY KEY,
        nid INTEGER NOT NULL,
        did INTEGER NOT NULL,
        ord INTEGER NOT NULL,
        mod INTEGER NOT NULL,
        usn INTEGER NOT NULL,
        type INTEGER NOT NULL,
        queue INTEGER NOT NULL,
        due INTEGER NOT NULL,
        ivl INTEGER NOT NULL,
        factor INTEGER NOT NULL,
        reps INTEGER NOT NULL,
        lapses INTEGER NOT NULL,
        left INTEGER NOT NULL,
        odue INTEGER NOT NULL,
        odid INTEGER NOT NULL,
        flags INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX ix_notes_guid ON notes (guid);
      CREATE INDEX ix_cards_nid ON cards (nid);
      CREATE INDEX ix_cards_did ON cards (did);
    `);

    const models: Record<string, unknown> = {};
    const decksConf: Record<string, unknown> = {};
    const insertNote = ankiDb.prepare(`
      INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
      VALUES (?, ?, ?, ?, -1, '', ?, ?, ?, 0, '')
    `);
    const insertCard = ankiDb.prepare(`
      INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
      VALUES (?, ?, ?, 0, ?, -1, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, '')
    `);

    const mediaMap: Record<string, string> = {};
    let mediaId = 0;
    const uploadsDir = getUploadsDir();
    let allCardCount = 0;

    const ankiEpoch = new Date(Date.UTC(2012, 4, 8));
    const colCrt = Math.floor(ankiEpoch.getTime() / 1000);

    // 每个牌组有自己的 numeric ID 和 model ID
    for (let di = 0; di < decks.length; di++) {
      const deck = decks[di];
      const numericDeckId = uuidToNumeric(deck.id as string) + di * 1000; // 避免冲突
      const modelId = numericDeckId + 1;

      // 模型
      models[String(modelId)] = {
        id: modelId,
        name: `Calligraphy Card (${deck.name as string})`,
        type: 0,
        mod: now,
        usn: -1,
        sortf: 0,
        did: numericDeckId,
        tmpls: [{
          name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{Front}}<hr id=answer>{{Back}}',
          bqfmt: '', bafmt: '', did: null, bfont: '', bsize: 0,
        }],
        flds: [
          { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Noto Sans SC', size: 20, media: [] },
          { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Noto Sans SC', size: 20, media: [] },
        ],
        css: `.card { font-family: "Noto Sans SC", sans-serif; font-size: 24px; text-align: center; }`,
        latexPre: '', latexPost: '', latexsvg: false,
        req: [[0, 'all', [0]]],
      };

      // 牌组
      decksConf[String(numericDeckId)] = {
        id: numericDeckId, name: deck.name, desc: '', dyn: 0, col: '',
        usn: -1, mod: now, conf: 1,
        lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0],
      };

      // 获取该牌组的卡片
      const { rows: cards } = await db.query(
        `SELECT id, front_text, back_text, image_url, ease, interval, repetitions, next_review
         FROM cards WHERE deck_id = $1 ORDER BY created_at ASC`,
        [deck.id]
      ) as unknown as { rows: Array<Record<string, unknown>> };

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const noteId = uuidToNumeric(card.id as string) + di * 1000 + 1;
        const cardId = noteId + 1;
        const guid = (card.id as string).replace(/-/g, '').slice(0, 8).toUpperCase() + di.toString(16);

        let backContent = (card.back_text as string) || '';
        const imageUrl = (card.image_url as string) || '';

        if (imageUrl) {
          const imgFilename = path.basename(imageUrl);
          const imgFilePath = path.resolve(uploadsDir, imgFilename);
          if (imgFilePath.startsWith(path.resolve(uploadsDir) + path.sep) && fs.existsSync(imgFilePath)) {
            zip.file(imgFilename, fs.readFileSync(imgFilePath));
            mediaMap[String(mediaId)] = imgFilename;
            mediaId++;
            backContent = backContent
              ? `${backContent}<br><img src="${imgFilename}">`
              : `<img src="${imgFilename}">`;
          }
        }

        if (!backContent) {
          backContent = card.front_text as string;
        }

        const flds = `${card.front_text as string}\x1f${backContent}`;
        insertNote.run(noteId, guid, modelId, now, flds, (card.front_text as string), 0);

        const interval = card.interval as number;
        const cardType = interval === 0 ? 0 : 2;
        const queue = interval === 0 ? 0 : 2;
        const ivl = interval === 0 ? 0 : Math.max(1, Math.round(interval / 1440));
        const due = interval === 0
          ? allCardCount
          : Math.max(0, Math.floor((new Date(card.next_review as string).getTime() / 1000 - colCrt) / 86400));
        const factor = Math.round((card.ease as number) * 1000);

        insertCard.run(cardId, noteId, numericDeckId, now, cardType, queue, due, ivl, factor, (card.repetitions as number));
        allCardCount++;
      }
    }

    // 写入 col
    const colConf = JSON.stringify({ curDeck: 1, activeDecks: [1] });

    ankiDb.prepare(`
      INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
      VALUES (1, ?, ?, ?, 11, 0, -1, 0, ?, ?, ?, '{}', '{}')
    `).run(colCrt, now, now, colConf, JSON.stringify(models), JSON.stringify(decksConf));

    const dbBuffer = ankiDb.serialize();
    ankiDb.close();
    zip.file('collection.anki2', dbBuffer);
    zip.file('media', JSON.stringify(mediaMap));

    zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }).then((zipBuffer) => {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="all_decks.apkg"');
      res.setHeader('Content-Length', zipBuffer.length);
      res.end(zipBuffer);
    }).catch((err) => {
      console.error('[export-all] ZIP generation error:', err);
      res.status(500).json({ error: 'Failed to generate APKG file' });
    });
  } catch (err) {
    console.error('GET /export error:', err);
    res.status(500).json({ error: 'Failed to export all decks' });
  }
});
