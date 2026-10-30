import React, { useEffect, useState } from 'react';
import { Box, Link } from '@mui/material';
import { Outlet, useLocation } from 'react-router-dom';
import TopBar from './TopBar';
import BottomNav from './BottomNav';
import { loadProductionFeatures } from '@/lib/productionFeatures';

/** 内容区统一宽度：与设计板的 1440 一致，超出后居中 */
const CONTENT_MAX = 1440;

/** 需要满幅的页面（学习卡、集字）不吃页面内边距 */
const FULL_BLEED = ['/study', '/jizi'];

/**
 * 应用外壳：顶部导航（桌面）/ 顶部字标（手机）+ 内容 + 底部标签栏（手机）。
 * 页面自带纵向节奏，外壳只负责宽度、横向边距与滚动。
 */
const AppShell: React.FC = () => {
  const location = useLocation();
  const [filing, setFiling] = useState<{ icp?: string; psb?: string } | null>(null);
  const fullBleed = FULL_BLEED.some((p) => location.pathname.startsWith(p));
  /** 学习页自带顶栏与计时，外壳不再叠一层 */
  const hideChrome = location.pathname.startsWith('/study');
  /** 集字页自带全屏画布，手机端也不叠字标栏 */
  const isJizi = location.pathname.startsWith('/jizi');

  useEffect(() => {
    loadProductionFeatures().then((f) => setFiling(f.filing));
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        height: '100dvh',
        overflow: 'hidden',
        backgroundColor: 'background.default',
      }}
    >
      {!hideChrome && (
        <>
          <Box sx={{ display: { xs: isJizi ? 'none' : 'block', md: 'none' } }}>
            <TopBar compact />
          </Box>
          <Box sx={{ display: { xs: 'none', md: 'block' } }}>
            <TopBar />
          </Box>
        </>
      )}

      <Box
        component="main"
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          pb: { xs: hideChrome ? 0 : 'calc(58px + env(safe-area-inset-bottom, 0px))', md: 0 },
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: fullBleed ? 'none' : CONTENT_MAX,
            height: fullBleed ? '100%' : undefined,
            minHeight: fullBleed ? 0 : undefined,
            position: 'relative',
            mx: 'auto',
            px: fullBleed ? 0 : { xs: 2.5, md: 5 },
            pt: fullBleed ? 0 : { xs: 2, md: 2.5 },
            pb: fullBleed ? 0 : { xs: 2, md: 2 },
          }}
        >
          <Outlet />
        </Box>

        {filing && !fullBleed && (
          <Box
            sx={{
              maxWidth: CONTENT_MAX,
              mx: 'auto',
              px: { xs: 2.5, md: 5 },
              py: 1.5,
              borderTop: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Box sx={{ display: 'flex', gap: 2.5, justifyContent: 'flex-end' }}>
              {filing.icp && (
                <Link
                  href="https://beian.mps.gov.cn/"
                  target="_blank"
                  rel="noopener noreferrer"
                  underline="hover"
                  sx={{ color: 'text.disabled', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                >
                  {filing.icp}
                </Link>
              )}
              {filing.psb && (
                <Link
                  href="https://beian.mps.gov.cn/"
                  target="_blank"
                  rel="noopener noreferrer"
                  underline="hover"
                  sx={{ color: 'text.disabled', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                >
                  {filing.psb}
                </Link>
              )}
            </Box>
          </Box>
        )}
      </Box>

      {!hideChrome && (
        <Box sx={{ display: { xs: 'block', md: 'none' } }}>
          <BottomNav />
        </Box>
      )}
    </Box>
  );
};

export default AppShell;
