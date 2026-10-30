import React from 'react';
import { Box } from '@mui/material';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/useAuthStore';
import { NAV_ITEMS } from './TopBar';

/**
 * 手机底部标签栏：等宽大写 + 中文，当前项顶部 3px 朱砂线。
 * 不用图标——保持和桌面同一套排印语言。
 */
const BottomNav: React.FC = () => {
  const location = useLocation();
  const { user } = useAuthStore();

  const items = user?.role === 'guest'
    ? NAV_ITEMS.filter((item) => item.to === '/dashboard' || item.to === '/market')
    : NAV_ITEMS;

  const isActive = (to: string): boolean =>
    to === '/dashboard'
      ? location.pathname === '/' || location.pathname.startsWith('/dashboard')
      : location.pathname.startsWith(to);

  return (
    <Box
      component="nav"
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: (t) => t.zIndex.appBar,
        display: 'grid',
        gridTemplateColumns: `repeat(${items.length}, 1fr)`,
        height: 'calc(58px + env(safe-area-inset-bottom, 0px))',
        pb: 'env(safe-area-inset-bottom, 0px)',
        borderTop: '2px solid',
        borderColor: 'text.primary',
        backgroundColor: 'background.default',
      }}
    >
      {items.map((item) => {
        const active = isActive(item.to);
        return (
          <Box
            key={item.to}
            component={NavLink}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            aria-label={item.cn}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              mt: '-2px',
              pt: '2px',
              textDecoration: 'none',
              color: 'text.primary',
              opacity: active ? 1 : 0.6,
              borderTop: '3px solid',
              borderColor: active ? 'primary.main' : 'transparent',
            }}
          >
            <Box
              component="span"
              sx={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.1em', lineHeight: 1 }}
            >
              {item.short ?? item.label}
            </Box>
            <Box component="span" sx={{ fontSize: 11.5, letterSpacing: '0.04em', lineHeight: 1 }}>
              {item.cn}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

export default BottomNav;
