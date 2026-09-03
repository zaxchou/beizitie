import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// JWT 密钥：生产环境必须通过环境变量提供，否则拒绝启动；
// 开发环境允许回退到固定默认值（仅本地使用）。
const DEV_FALLBACK_SECRET = 'dev-secret-change-in-production';

function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[FATAL] 生产环境未设置 JWT_SECRET 环境变量。' +
      '使用已知默认密钥会允许任何人伪造管理员令牌，拒绝启动。'
    );
    process.exit(1);
  }
  console.warn('[警告] 未设置 JWT_SECRET，使用开发默认密钥（请勿用于生产）。');
  return DEV_FALLBACK_SECRET;
}

const JWT_SECRET = resolveJwtSecret();

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      user?: { userId: string; username: string; role: string };
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 公开路由跳过鉴权
  if (req.path.startsWith('/jizi/') || req.path.startsWith('/auth/')) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '未提供认证令牌' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string; username: string; role: string };
    req.user = { userId: payload.userId, username: payload.username, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: '认证令牌无效或已过期' });
  }
}

/** 需要管理员权限的中间件（必须在 authMiddleware 之后使用） */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: '需要管理员权限' });
    return;
  }
  next();
}

/** 游客角色常量 */
export const GUEST_ROLE = 'guest';

/** 导出 JWT_SECRET 供 auth router 使用 */
export { JWT_SECRET };
