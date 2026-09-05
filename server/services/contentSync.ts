import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type pkg from 'pg';
import { getUploadsDir } from '../db.js';
import { imageUrlForPackageFilename, type DeckContentPackage, type ParsedContentPackage, validateContentPackage } from './contentPackage.js';
import { filenameFromImageUrl } from './contentKeys.js';

export interface ContentSyncResult {
  dry_run: boolean;
  deck: { action: 'create' | 'update' | 'noop'; source_key: string; id?: string; name: string };
  cards: { added: number; updated: number; archived: number; unchanged: number };
  marketplace: { action: 'create' | 'update' | 'noop' | 'skip' };
  uploads: { added: number; reused: number; missing: number };
  warnings: string[];
}

type Db = pkg.Pool;
type Client = pkg.PoolClient;
type DbLike = Db | Client;

function uuid(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalize(value: unknown): string {
  return String(value ?? '');
}

function isStudyMode(value: unknown): value is 'default' | 'sequential' | 'random' {
  return value === 'default' || value === 'sequential' || value === 'random';
}

async function getSystemAdminId(db: DbLike): Promise<string | null> {
  const { rows } = await db.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`);
  return rows[0]?.id ?? null;
}

async function ensureUploads(parsed: ParsedContentPackage, dryRun: boolean, result: ContentSyncResult): Promise<void> {
  const uploadsDir = getUploadsDir();
  if (!dryRun && !fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // 收集所有需要写入的图片：卡片图片 + marketplace 封面
  const filenames = new Set<string>();
  for (const card of parsed.manifest.cards) {
    if (card.image_filename) filenames.add(card.image_filename);
  }
  const mp = parsed.manifest.deck.marketplace;
  if (mp) {
    for (const url of [mp.cover_image, mp.cover_thumb]) {
      const fn = filenameFromImageUrl(url || '');
      if (fn) filenames.add(fn);
    }
  }

  for (const filename of filenames) {
    const buffer = parsed.files.get(filename);
    if (!buffer) {
      result.uploads.missing++;
      result.warnings.push(`Missing upload file in package: ${filename}`);
      continue;
    }

    const targetPath = path.resolve(uploadsDir, filename);
    if (!targetPath.startsWith(path.resolve(uploadsDir) + path.sep)) {
      result.warnings.push(`Unsafe filename skipped: ${filename}`);
      continue;
    }
    if (fs.existsSync(targetPath)) {
      result.uploads.reused++;
      continue;
    }
    result.uploads.added++;
    if (!dryRun) fs.writeFileSync(targetPath, buffer);
  }
}

function cardChanged(existing: Record<string, unknown>, next: DeckContentPackage['cards'][number]): boolean {
  return (
    normalize(existing.front_text) !== next.front_text ||
    normalize(existing.back_text) !== next.back_text ||
    normalize(existing.image_url) !== imageUrlForPackageFilename(next.image_filename) ||
    Number(existing.sort_order || 0) !== next.sort_order ||
    Boolean(existing.archived_at)
  );
}

async function runContentSync(db: Db, parsed: ParsedContentPackage, dryRun: boolean): Promise<ContentSyncResult> {
  validateContentPackage(parsed.manifest);
  const manifest = parsed.manifest;
  const result: ContentSyncResult = {
    dry_run: dryRun,
    deck: { action: 'noop', source_key: manifest.deck.source_key, name: manifest.deck.name },
    cards: { added: 0, updated: 0, archived: 0, unchanged: 0 },
    marketplace: { action: 'skip' },
    uploads: { added: 0, reused: 0, missing: 0 },
    warnings: [],
  };

  await ensureUploads(parsed, dryRun, result);
  if (result.uploads.missing > 0) throw new Error('Content package is missing upload files');

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: deckRows } = await client.query(
      `SELECT id, name, article_text, study_mode FROM decks WHERE source_key = $1 LIMIT 1`,
      [manifest.deck.source_key]
    );

    let deckId: string;
    const now = nowISO();
    const studyMode = isStudyMode(manifest.deck.study_mode) ? manifest.deck.study_mode : 'default';

    if (deckRows.length > 0) {
      const existing = deckRows[0];
      deckId = existing.id;
      result.deck.id = deckId;
      const needsDeckUpdate =
        existing.name !== manifest.deck.name ||
        normalize(existing.article_text) !== normalize(manifest.deck.article_text) ||
        normalize(existing.study_mode) !== studyMode;
      result.deck.action = needsDeckUpdate ? 'update' : 'noop';
      if (!dryRun && needsDeckUpdate) {
        await client.query(
          `UPDATE decks
           SET name = $1, article_text = $2, study_mode = $3, updated_at = $4,
               content_version = COALESCE(content_version, 1) + 1
           WHERE id = $5`,
          [manifest.deck.name, manifest.deck.article_text ?? '', studyMode, now, deckId]
        );
      }
    } else {
      deckId = uuid();
      result.deck = { action: 'create', source_key: manifest.deck.source_key, id: deckId, name: manifest.deck.name };
      if (!dryRun) {
        const adminId = await getSystemAdminId(client);
        await client.query(
          `INSERT INTO decks (id, name, card_count, daily_new_card_limit, daily_review_limit, user_id,
                              created_at, updated_at, article_text, study_mode, source_key, content_version)
           VALUES ($1, $2, 0, 20, 200, $3, $4, $5, $6, $7, $8, 1)`,
          [deckId, manifest.deck.name, adminId, now, now, manifest.deck.article_text ?? '', studyMode, manifest.deck.source_key]
        );
      }
    }

    const { rows: existingCards } = await client.query(
      `SELECT id, source_key, front_text, back_text, image_url, sort_order, archived_at
       FROM cards WHERE deck_id = $1`,
      [deckId]
    );
    const existingByKey = new Map(existingCards.map((card: Record<string, unknown>) => [String(card.source_key), card]));
    const packageKeys = new Set(manifest.cards.map((card) => card.source_key));

    for (const card of manifest.cards) {
      const existing = existingByKey.get(card.source_key);
      if (existing) {
        if (cardChanged(existing, card)) {
          result.cards.updated++;
          if (!dryRun) {
            await client.query(
              `UPDATE cards
               SET front_text = $1, back_text = $2, image_url = $3, sort_order = $4, updated_at = $5, archived_at = NULL
               WHERE id = $6`,
              [card.front_text, card.back_text, imageUrlForPackageFilename(card.image_filename), card.sort_order, now, existing.id]
            );
          }
        } else {
          result.cards.unchanged++;
        }
      } else {
        result.cards.added++;
        if (!dryRun) {
          await client.query(
            `INSERT INTO cards (id, deck_id, front_text, back_text, image_url, ease, interval, repetitions,
                                next_review, last_review, user_id, created_at, updated_at, sort_order, source_key, archived_at)
             VALUES ($1, $2, $3, $4, $5, 2.5, 0, 0, $6, NULL, NULL, $7, $8, $9, $10, NULL)`,
            [uuid(), deckId, card.front_text, card.back_text, imageUrlForPackageFilename(card.image_filename), now, now, now, card.sort_order, card.source_key]
          );
        }
      }
    }

    for (const existing of existingCards as Array<Record<string, unknown>>) {
      const sourceKey = String(existing.source_key || '');
      if (!sourceKey || packageKeys.has(sourceKey) || existing.archived_at) continue;
      result.cards.archived++;
      if (!dryRun) {
        await client.query('UPDATE cards SET archived_at = $1, updated_at = $2 WHERE id = $3', [now, now, existing.id]);
      }
    }

    const marketplace = manifest.deck.marketplace;
    if (marketplace?.published) {
      const { rows: existingMarket } = await client.query('SELECT deck_id FROM marketplace_decks WHERE deck_id = $1', [deckId]);
      result.marketplace.action = existingMarket.length > 0 ? 'update' : 'create';
      if (!dryRun) {
        await client.query(
          `INSERT INTO marketplace_decks
             (deck_id, calligrapher, dynasty, style, description, cover_image, cover_thumb, featured, sort_order, published_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10)
           ON CONFLICT (deck_id) DO UPDATE SET
             calligrapher = excluded.calligrapher,
             dynasty = excluded.dynasty,
             style = excluded.style,
             description = excluded.description,
             cover_image = excluded.cover_image,
             cover_thumb = excluded.cover_thumb,
             featured = excluded.featured,
             published_at = COALESCE(marketplace_decks.published_at, excluded.published_at)`,
          [deckId, marketplace.calligrapher, marketplace.dynasty, marketplace.style, marketplace.description,
            marketplace.cover_image, marketplace.cover_thumb ?? '', marketplace.featured ? 1 : 0, now, now]
        );
      }
    }

    if (!dryRun) {
      const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS cnt FROM cards WHERE deck_id = $1 AND archived_at IS NULL', [deckId]);
      await client.query('UPDATE decks SET card_count = $1, updated_at = $2 WHERE id = $3', [countRows[0].cnt, now, deckId]);
    }

    if (dryRun) await client.query('ROLLBACK');
    else await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function dryRunContentPackage(db: Db, parsed: ParsedContentPackage): Promise<ContentSyncResult> {
  return runContentSync(db, parsed, true);
}

export function applyContentPackage(db: Db, parsed: ParsedContentPackage): Promise<ContentSyncResult> {
  return runContentSync(db, parsed, false);
}
