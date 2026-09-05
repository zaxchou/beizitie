import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import type pkg from 'pg';
import { getUploadsDir } from '../db.js';
import { cardSourceKey, deckSourceKey, filenameFromImageUrl, imageUrlFromFilename } from './contentKeys.js';

export interface DeckContentPackage {
  format_version: 1;
  exported_at: string;
  deck: {
    source_key: string;
    name: string;
    article_text: string | null;
    study_mode: 'default' | 'sequential' | 'random';
    marketplace?: {
      calligrapher: string;
      dynasty: string;
      style: string;
      description: string;
      cover_image: string;
      cover_thumb?: string;
      featured: boolean;
      published: boolean;
    };
  };
  cards: Array<{
    source_key: string;
    front_text: string;
    back_text: string;
    image_filename: string | null;
    image_sha256: string | null;
    sort_order: number;
  }>;
}

export interface ParsedContentPackage {
  manifest: DeckContentPackage;
  files: Map<string, Buffer>;
}

type DbLike = pkg.Pool | pkg.PoolClient;

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sanitizePackageFilename(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'deck';
}

function ensureStudyMode(value: unknown): 'default' | 'sequential' | 'random' {
  return value === 'sequential' || value === 'random' ? value : 'default';
}

export async function buildContentPackage(db: DbLike, deckId: string): Promise<{ filename: string; buffer: Buffer; manifest: DeckContentPackage }> {
  const { rows: deckRows } = await db.query(
    `SELECT d.id, d.name, d.article_text, d.study_mode, d.source_key,
            md.calligrapher, md.dynasty, md.style, md.description, md.cover_image, md.cover_thumb,
            md.featured, md.published_at
     FROM decks d
     LEFT JOIN marketplace_decks md ON md.deck_id = d.id
     WHERE d.id = $1`,
    [deckId]
  ) as { rows: Array<Record<string, unknown>> };
  const deck = deckRows[0];
  if (!deck) throw new Error('Deck not found');

  const deckKey = String(deck.source_key || '') || deckSourceKey(String(deck.name));
  if (!deck.source_key) {
    await db.query('UPDATE decks SET source_key = $1 WHERE id = $2', [deckKey, deckId]);
  }

  const { rows: cardRows } = await db.query(
    `SELECT id, front_text, back_text, image_url, sort_order, source_key
     FROM cards
     WHERE deck_id = $1 AND archived_at IS NULL
     ORDER BY NULLIF(sort_order, 0) ASC NULLS LAST, created_at ASC`,
    [deckId]
  ) as { rows: Array<Record<string, unknown>> };

  const uploadsDir = getUploadsDir();
  const zip = new JSZip();
  const uploadsFolder = zip.folder('uploads');
  const cards: DeckContentPackage['cards'] = [];

  for (let i = 0; i < cardRows.length; i++) {
    const card = cardRows[i];
    const sortOrder = Number(card.sort_order || 0) || i + 1;
    const cardKey = String(card.source_key || '') || cardSourceKey(deckKey, sortOrder, String(card.front_text || ''));
    if (!card.source_key) {
      await db.query('UPDATE cards SET source_key = $1, sort_order = $2 WHERE id = $3', [cardKey, sortOrder, card.id]);
    }

    const imageFilename = filenameFromImageUrl(String(card.image_url || ''));
    let imageSha: string | null = null;
    if (imageFilename) {
      const imagePath = path.resolve(uploadsDir, imageFilename);
      if (imagePath.startsWith(path.resolve(uploadsDir) + path.sep) && fs.existsSync(imagePath)) {
        const imageBuffer = fs.readFileSync(imagePath);
        imageSha = sha256(imageBuffer);
        uploadsFolder?.file(imageFilename, imageBuffer);
      }
    }

    cards.push({
      source_key: cardKey,
      front_text: String(card.front_text || ''),
      back_text: String(card.back_text || ''),
      image_filename: imageFilename,
      image_sha256: imageSha,
      sort_order: sortOrder,
    });
  }

  // 打包 market cover_image / cover_thumb（manifest 有路径但图片也要进包）
  for (const coverField of [String(deck.cover_image || ''), String(deck.cover_thumb || '')]) {
    const coverFilename = filenameFromImageUrl(coverField);
    if (coverFilename && !uploadsFolder?.file(coverFilename)) {
      const coverPath = path.join(uploadsDir, coverFilename);
      if (fs.existsSync(coverPath)) {
        uploadsFolder?.file(coverFilename, fs.readFileSync(coverPath));
      }
    }
  }

  const published = Boolean(deck.published_at);
  const manifest: DeckContentPackage = {
    format_version: 1,
    exported_at: new Date().toISOString(),
    deck: {
      source_key: deckKey,
      name: String(deck.name),
      article_text: typeof deck.article_text === 'string' ? deck.article_text : '',
      study_mode: ensureStudyMode(deck.study_mode),
      marketplace: {
        calligrapher: String(deck.calligrapher || ''),
        dynasty: String(deck.dynasty || ''),
        style: String(deck.style || ''),
        description: String(deck.description || ''),
        cover_image: String(deck.cover_image || ''),
        cover_thumb: String(deck.cover_thumb || ''),
        featured: Number(deck.featured || 0) === 1,
        published,
      },
    },
    cards,
  };

  zip.file('deck-content.json', JSON.stringify(manifest, null, 2));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return {
    filename: `${sanitizePackageFilename(String(deck.name))}.content.zip`,
    buffer,
    manifest,
  };
}

export async function parseContentPackage(buffer: Buffer): Promise<ParsedContentPackage> {
  const zip = await JSZip.loadAsync(buffer);
  const manifestFile = zip.file('deck-content.json');
  if (!manifestFile) throw new Error('Invalid content package: missing deck-content.json');

  const manifest = JSON.parse(await manifestFile.async('string')) as DeckContentPackage;
  validateContentPackage(manifest);

  const files = new Map<string, Buffer>();
  const fileEntries = Object.values(zip.files).filter((entry) => !entry.dir && entry.name.startsWith('uploads/'));
  for (const entry of fileEntries) {
    files.set(path.basename(entry.name), await entry.async('nodebuffer'));
  }
  return { manifest, files };
}

export function validateContentPackage(manifest: DeckContentPackage): void {
  if (manifest.format_version !== 1) throw new Error('Unsupported content package format_version');
  if (!manifest.deck?.source_key || !manifest.deck?.name) throw new Error('Invalid content package: missing deck source_key/name');
  if (!Array.isArray(manifest.cards)) throw new Error('Invalid content package: cards must be an array');

  const sourceKeys = new Set<string>();
  for (const card of manifest.cards) {
    if (!card.source_key) throw new Error('Invalid content package: card missing source_key');
    if (sourceKeys.has(card.source_key)) throw new Error(`Invalid content package: duplicate card source_key ${card.source_key}`);
    sourceKeys.add(card.source_key);
  }
}

export function imageUrlForPackageFilename(filename: string | null): string {
  return imageUrlFromFilename(filename);
}
