import React, { useMemo, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Box, useMediaQuery, useTheme, Typography, IconButton, Tooltip, Link,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import TopBar from './TopBar';
import BottomNav from './BottomNav';
import SideMenu from './SideMenu';
import SidebarStats from '@/components/dashboard/SidebarStats';
import { useAuthStore } from '@/stores/useAuthStore';
import { loadProductionFeatures } from '@/lib/productionFeatures';

/** 路由路径 → 页面标题映射 */
const ROUTE_TITLE_MAP: Record<string, string> = {
  '/': '背字帖',
  '/dashboard': '背字帖',
  '/decks': '牌组',
  '/analytics': '数据分析',
  '/settings': '设置',
  '/study': '学习',
  '/market': '市场',
  '/jizi': '集字',
};

/** PC 端侧边栏宽度（px） */
const SIDE_MENU_WIDTH = 280;

/**
 * 应用外壳布局组件。
 * - 移动端（<md）：TopBar + 内容 + BottomNav（原布局）
 * - PC 端（>=md）：TopBar + 左侧固定 SideMenu（含统计 + 日历） + 主内容
 * 页面标题根据当前路由自动映射。
 */
const AppShell: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const isPc = useMediaQuery(theme.breakpoints.up('md'));
  const { user, logout } = useAuthStore();
  const [filing, setFiling] = useState<{ icp?: string; psb?: string } | null>(null);

  useEffect(() => {
    loadProductionFeatures().then((f) => setFiling(f.filing));
  }, []);

  /** 根据当前路径自动匹配页面标题 */
  const title = useMemo((): string => {
    const pathname = location.pathname;

    if (ROUTE_TITLE_MAP[pathname]) {
      return ROUTE_TITLE_MAP[pathname];
    }

    for (const [route, label] of Object.entries(ROUTE_TITLE_MAP)) {
      if (route !== '/' && pathname.startsWith(route)) {
        return label;
      }
    }

    return '书法记忆';
  }, [location.pathname]);

  /** 侧边栏子内容（学习概览：6 数据卡 + 日历 + 总结），仅 PC 端 */
  const sideMenuContent = useMemo(
    () => <SidebarStats />,
    []
  );

  return (
    <Box className="flex flex-col" sx={{ minHeight: '100vh', height: '100dvh', overflow: 'hidden' }}>
      <Box sx={{ display: { xs: location.pathname.startsWith('/jizi') ? 'none' : 'block', md: 'none' }, flexShrink: 0 }}>
        <TopBar title={title}>
          {user && user.role !== 'guest' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>
                {user.username}
              </Typography>
              <Tooltip title="退出登录">
                <IconButton
                  size="small"
                  onClick={() => { logout(); navigate('/login'); }}
                >
                  <LogoutIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </TopBar>
      </Box>
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        {isPc && <SideMenu width={SIDE_MENU_WIDTH}>{sideMenuContent}</SideMenu>}
        <Box
          component="main"
          sx={{
            flex: 1,
            minWidth: 0,
            maxWidth: '100%',
            overflowX: 'hidden',
            overflowY: location.pathname.startsWith('/jizi') ? 'hidden' : 'auto',
            WebkitOverflowScrolling: 'touch',
            px: { xs: location.pathname.startsWith('/jizi') ? 0 : 2, md: location.pathname.startsWith('/jizi') ? 0 : 4 },
            py: location.pathname.startsWith('/jizi') ? 0 : 3,
            pb: { xs: '56px', md: 0 },
          }}
        >
          <Outlet />
        </Box>
      </Box>
      {!isPc && <BottomNav />}

      {/* 备案号（生产环境） */}
      {filing && (
        <Box
          sx={{
            textAlign: 'center',
            py: 1.5,
            px: 2,
            bgcolor: 'background.paper',
            borderTop: 1,
            borderColor: 'divider',
            mt: 'auto',
          }}
        >
          {filing.icp && (
            <Link
              href="https://beian.mps.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              sx={{ color: 'text.disabled', fontSize: 12, mr: 2 }}
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
              sx={{ color: 'text.disabled', fontSize: 12 }}
            >
              {filing.psb}
            </Link>
          )}
        </Box>
      )}
    </Box>
  );
};

export default AppShell;
