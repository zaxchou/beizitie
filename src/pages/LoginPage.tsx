import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import {
  Box, Card, CardContent, TextField, Button, Typography, Link, Alert,
  CircularProgress, InputAdornment, IconButton, Divider,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { FormControlLabel, Checkbox } from '@mui/material';
import { useAuthStore } from '@/stores/useAuthStore';
import { loadProductionFeatures } from '@/lib/productionFeatures';
import { guestLogin } from '@/lib/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoading, error, clearError, authConfig, fetchConfig } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [guestMode, setGuestMode] = useState(false);
  const [guestLoggingIn, setGuestLoggingIn] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  // 初始化：查系统配置 + 生产特性。游客模式直接自动登录，不渲染登录表单
  useEffect(() => {
    fetchConfig();
    loadProductionFeatures().then((f) => {
      setGuestMode(f.guestMode);
      if (f.guestMode && !new URLSearchParams(location.search).has('login')) {
        // 游客模式自动登录，不显示任何表单
        setGuestLoggingIn(true);
        guestLogin().then((res) => {
          useAuthStore.getState().loginFromGuest(res);
          navigate('/', { replace: true });
        }).catch(() => {
          setGuestLoggingIn(false);
          setInitializing(false);
        });
      } else {
        setInitializing(false);
      }
    });
  }, []);

  // 初始化的 loading 中 —— 不显示任何内容
  if (initializing) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
        {guestLoggingIn && <CircularProgress />}
      </Box>
    );
  }

  const handleGuestLogin = async () => {
    setGuestLoggingIn(true);
    try {
      const res = await guestLogin();
      useAuthStore.getState().loginFromGuest(res);
      navigate('/', { replace: true });
    } catch {
      setGuestLoggingIn(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(username, password, rememberMe);
      navigate(from, { replace: true });
    } catch {
      // error 已由 store 保存
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 400, width: '100%', boxShadow: '0px 0px 0px 1px rgba(0,0,0,0.08)' }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Typography variant="h4" sx={{ fontFamily: '"Noto Serif SC", serif', mb: 0.5 }}>
              {'\u{1F58B}'} 背字帖
            </Typography>
            <Typography variant="body2" color="text.secondary">
              书法记忆卡
            </Typography>
          </Box>

          {authConfig && !authConfig.hasUsers && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>欢迎使用 背字帖</strong><br />
                系统中还没有用户，请先{' '}
                <Link component={RouterLink} to="/register" underline="hover">
                  注册
                </Link>{' '}
                第一个管理员账号来开始使用。
              </Typography>
            </Alert>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={clearError}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              margin="normal"
              autoComplete="username"
              autoFocus
              disabled={isLoading}
            />
            <TextField
              fullWidth
              label="密码"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              margin="normal"
              autoComplete="current-password"
              disabled={isLoading}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowPassword(!showPassword)} edge="end" size="small">
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  size="small"
                />
              }
              label={<Typography variant="body2">记住我</Typography>}
              sx={{ mt: 0.5 }}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              disabled={isLoading || !username || !password}
              sx={{ mt: 1, mb: 1.5, py: 1.2 }}
            >
              {isLoading ? <CircularProgress size={24} color="inherit" /> : '登录'}
            </Button>
          </Box>

          {/* 游客模式分隔线 + 入口 */}
          {guestMode && (
            <>
              <Divider sx={{ my: 2 }} />
              <Button
                fullWidth
                variant="outlined"
                size="large"
                onClick={handleGuestLogin}
                disabled={guestLoggingIn}
                sx={{ py: 1.2, mb: 1.5 }}
              >
                {guestLoggingIn ? <CircularProgress size={24} /> : '游客浏览'}
              </Button>
            </>
          )}

          <Typography variant="body2" align="center" color="text.secondary">
            没有账号？{' '}
            <Link component={RouterLink} to="/register" underline="hover">
              注册
            </Link>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
