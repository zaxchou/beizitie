import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db.js';
import { JWT_SECRET, authMiddleware } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 读取生产配置（仅生产模式）。返回 null 表示无生产配置（开发/本地模式）。 */
function loadProductionConfig(): Record<string, unknown> | null {
  const configPath = path.join(__dirname, '..', 'production-config.json');
  try {
    if (process.env.NODE_ENV !== 'production') return null;
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

export const authRouter = Router();

const GUEST_USER_ID = '00000000-0000-0000-0000-000000000000';
const GUEST_USERNAME = 'guest';
const GUEST_ROLE = 'guest';

// GET /api/auth/production-features — 读取生产环境开关（仅生产有效，本地返回空对象）
authRouter.get('/production-features', (_req: Request, res: Response) => {
  const config = loadProductionConfig();
  if (!config) {
    // 开发/本地模式：返回空开关（所有功能正常）
    res.json({ guestMode: false, filing: null });
    return;
  }
  res.json({
    guestMode: !!config.guestMode,
    filing: config.filing || null,
  });
});

// POST /api/auth/guest — 游客登录（仅生产环境 guestMode 开启时登录，并订阅预设牌组）
authRouter.post('/guest', async (_req: Request, res: Response) => {
  const config = loadProductionConfig();
  if (!config || !config.guestMode) {
    res.status(403).json({ error: '游客模式未开启' });
    return;
  }
  const token = jwt.sign(
    { userId: GUEST_USER_ID, username: GUEST_USERNAME, role: GUEST_ROLE },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  // 为游客订阅预设牌组
  const subscriptions = (config.guestSubscriptions as string[]) || [];
  if (subscriptions.length > 0) {
    try {
      const db = getDb();
      for (const deckId of subscriptions) {
        const now = new Date().toISOString();
        await db.query(
          'INSERT INTO user_subscriptions (user_id, deck_id, subscribed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [GUEST_USER_ID, deckId, now]
        );
      }
    } catch (err) {
      console.error('[guest] 订阅预设牌组失败:', err);
      // 不因订阅失败影响游客登录
    }
  }
  res.json({ token, user: { id: GUEST_USER_ID, username: GUEST_USERNAME, role: GUEST_ROLE } });
});

function uuid(): string { return crypto.randomUUID(); }

// GET /api/auth/config — 查询系统状态（无需鉴权）
authRouter.get('/config', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const { rows } = await db.query('SELECT COUNT(*)::int as cnt FROM users');
    res.json({ hasUsers: rows[0].cnt > 0 });
  } catch (err) {
    console.error('GET /auth/config error:', err);
    res.status(500).json({ error: '无法获取系统状态' });
  }
});

// POST /api/auth/register
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    // 校验
    if (!username || typeof username !== 'string' || username.trim().length < 2 || username.trim().length > 20) {
      res.status(400).json({ error: '用户名需要 2-20 个字符' });
      return;
    }
    if (!password || typeof password !== 'string' || password.length < 6 || password.length > 64) {
      res.status(400).json({ error: '密码需要 6-64 个字符' });
      return;
    }

    const db = getDb();
    const cleanUsername = username.trim();

    // 使用 SERIALIZABLE 事务防止并发注册时产生多个管理员
    // 同时依赖 partial unique index one_admin 作为兜底
    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      // 检查用户名唯一性
      const existing = (await client.query('SELECT id FROM users WHERE username = $1', [cleanUsername])).rows[0];
      if (existing) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: '用户名已存在' });
        return;
      }

      // 如果数据库中还没有用户，第一个注册者自动成为管理员
      const { rows: userCount } = await client.query('SELECT COUNT(*)::int as cnt FROM users');
      const role = userCount[0].cnt === 0 ? 'admin' : 'user';

      // 创建用户
      const id = uuid();
      const passwordHash = bcrypt.hashSync(password, 10);
      const now = new Date().toISOString();
      await client.query(
        'INSERT INTO users (id, username, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
        [id, cleanUsername, passwordHash, role, now]
      );

      await client.query('COMMIT');

      // 签发 JWT
      const token = jwt.sign({ userId: id, username: cleanUsername, role }, JWT_SECRET, { expiresIn: '7d' });
      res.status(201).json({ token, user: { id, username: cleanUsername, role } });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('POST /auth/register error:', err);
    res.status(500).json({ error: '注册失败' });
  }
});

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: '用户名和密码不能为空' });
      return;
    }

    const db = getDb();
    const { rows } = await db.query(
      'SELECT id, username, password_hash, role FROM users WHERE username = $1',
      [username.trim()]
    );
    const user = rows[0] as { id: string; username: string; password_hash: string; role: string } | undefined;

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    const { rememberMe } = req.body;
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: rememberMe ? '365d' : '7d' }
    );

    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error('POST /auth/login error:', err);
    res.status(500).json({ error: '登录失败' });
  }
});

// PUT /api/auth/password — 修改密码（需鉴权）
authRouter.put('/password', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { oldPassword, newPassword } = req.body ?? {};
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: '未认证' });
      return;
    }
    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: '请填写旧密码和新密码' });
      return;
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 64) {
      res.status(400).json({ error: '新密码需要 6-64 个字符' });
      return;
    }
    if (oldPassword === newPassword) {
      res.status(400).json({ error: '新密码不能与旧密码相同' });
      return;
    }

    const db = getDb();
    const user = (await db.query('SELECT password_hash FROM users WHERE id = $1', [userId])).rows[0] as { password_hash: string } | undefined;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
      res.status(401).json({ error: '旧密码错误' });
      return;
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /auth/password error:', err);
    res.status(500).json({ error: '修改密码失败' });
  }
});
