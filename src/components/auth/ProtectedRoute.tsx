import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/useAuthStore';

export function ProtectedRoute() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // 游客角色：只能访问首页、市场和（已订阅的）学习页面
  if (user?.role === 'guest') {
    if (
      location.pathname !== '/' &&
      !location.pathname.startsWith('/dashboard') &&
      !location.pathname.startsWith('/market') &&
      !location.pathname.startsWith('/study/')
    ) {
      return <Navigate to="/" replace />;
    }
  }

  return <Outlet />;
}
