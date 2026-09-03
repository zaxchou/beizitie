import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import BarChartIcon from '@mui/icons-material/BarChart';
import SettingsIcon from '@mui/icons-material/Settings';
import StoreIcon from '@mui/icons-material/Store';
import BrushIcon from '@mui/icons-material/Brush';
import { useAuthStore } from '@/stores/useAuthStore';

/** 导航项定义 */
interface NavItem {
  /** 图标组件 */
  icon: React.ReactNode;
  /** 显示标签 */
  label: string;
  /** 对应的路由路径 */
  value: string;
}

const navItems: NavItem[] = [
  {
    icon: <DashboardIcon />,
    label: '背字帖',
    value: '/dashboard',
  },
  {
    icon: <StoreIcon />,
    label: '市场',
    value: '/market',
  },
  {
    icon: <BrushIcon />,
    label: '集字',
    value: '/jizi',
  },
  {
    icon: <BarChartIcon />,
    label: '数据',
    value: '/analytics',
  },
  {
    icon: <SettingsIcon />,
    label: '设置',
    value: '/settings',
  },
];

/**
 * 底部导航栏。
 * 使用 react-router 的 useNavigate + useLocation 同步当前路由。
 * 固定在底部（sticky），顶部有分隔线。
 */
const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();

  // 游客只显示仪表盘和市场
  const visibleNav = user?.role === 'guest'
    ? navItems.filter(item => item.value === '/dashboard' || item.value === '/market')
    : navItems;

  const handleChange = (_event: React.SyntheticEvent, newValue: string): void => {
    navigate(newValue);
  };

  /** 根据当前路径匹配高亮项 */
  const currentValue = visibleNav.find((item) => {
    if (item.value === '/dashboard') {
      return location.pathname === '/' || location.pathname.startsWith('/dashboard');
    }
    return location.pathname.startsWith(item.value);
  })?.value ?? '/dashboard';

  return (
    <Paper
      sx={{
        position: 'fixed',
        bottom: 0, left: 0, right: 0,
        borderTop: 0,
      }}
      elevation={0}
    >
      <BottomNavigation value={currentValue} onChange={handleChange}>
        {visibleNav.map((item) => (
          <BottomNavigationAction
            key={item.value}
            label={item.label}
            value={item.value}
            icon={item.icon}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
};

export default BottomNav;
