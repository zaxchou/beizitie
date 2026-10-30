import React from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/useAuthStore';
import { APP_VERSION } from '@/core/version';

/** 全站导航：等宽大写 + 中文，当前项用 2px 墨线压住 */
export const NAV_ITEMS: { to: string; label: string; short?: string; cn: string }[] = [
  { to: '/dashboard', label: 'TODAY', cn: '今日' },
  { to: '/market', label: 'MARKET', cn: '市场' },
  { to: '/jizi', label: 'JIZI', cn: '集字' },
  { to: '/analytics', label: 'STATS', cn: '统计' },
  { to: '/settings', label: 'SETTINGS', short: 'SET', cn: '设置' },
];

export interface TopBarProps {
  /** true = 手机窄栏（只有字标 + 用户），false = 桌面完整导航 */
  compact?: boolean;
}

const TopBar: React.FC<TopBarProps> = ({ compact = false }) => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (to: string): boolean =>
    to === '/dashboard'
      ? location.pathname === '/' || location.pathname.startsWith('/dashboard')
      : location.pathname.startsWith(to);

  const nav = user?.role === 'guest'
    ? NAV_ITEMS.filter((item) => item.to === '/dashboard' || item.to === '/market')
    : NAV_ITEMS;

  const account = user && user.role !== 'guest' ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.04em' }}>
        {user.username}
        {!compact && ` · v${APP_VERSION}`}
      </Typography>
      <Tooltip title="退出登录">
        <IconButton
          size="small"
          aria-label="退出登录"
          sx={{ color: 'text.primary', '&:hover': { backgroundColor: 'transparent', opacity: 0.6 } }}
          onClick={() => { logout(); navigate('/login'); }}
        >
          <LogoutIcon sx={{ fontSize: 17 }} />
        </IconButton>
      </Tooltip>
    </Box>
  ) : null;

  return (
    <Box
      component="header"
      sx={{
        flexShrink: 0,
        height: compact ? 56 : 64,
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 2 : 3.5,
        px: compact ? 2.5 : 5,
        borderBottom: '2px solid',
        borderColor: 'text.primary',
        backgroundColor: 'background.default',
      }}
    >
      <Typography
        component={NavLink}
        to="/dashboard"
        sx={{
          fontSize: compact ? 18 : 22,
          fontWeight: 900,
          letterSpacing: compact ? '0.06em' : '0.1em',
          color: 'text.primary',
          textDecoration: 'none',
          lineHeight: 1,
        }}
      >
        背字帖
      </Typography>

      {!compact && (
        <Box component="nav" sx={{ display: 'flex', gap: 2.75 }}>
          {nav.map((item) => {
            const active = isActive(item.to);
            return (
              <Box
                key={item.to}
                component={NavLink}
                to={item.to}
                aria-label={item.cn}
                sx={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  letterSpacing: '0.06em',
                  color: 'text.primary',
                  textDecoration: 'none',
                  opacity: active ? 1 : 0.62,
                  borderBottom: active ? '2px solid' : '2px solid transparent',
                  borderColor: active ? 'text.primary' : 'transparent',
                  paddingBottom: '2px',
                  '&:hover': { opacity: 1 },
                }}
              >
                {item.label}
                <Box component="span" sx={{ ml: 0.75, opacity: 0.62, letterSpacing: '0.02em' }}>
                  {item.cn}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      <Box sx={{ marginLeft: 'auto' }}>{account}</Box>
    </Box>
  );
};

export default TopBar;
