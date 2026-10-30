import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import { Box, Button, Typography, Link, CircularProgress, Checkbox, FormControlLabel } from '@mui/material';
import { useAuthStore } from '@/stores/useAuthStore';
import { loadProductionFeatures } from '@/lib/productionFeatures';
import { guestLogin } from '@/lib/api';
import { APP_VERSION } from '@/core/version';

/** 米纸/墨底对开的登录页：左边只有字标，右边是表单 */
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

  useEffect(() => {
    fetchConfig();
    loadProductionFeatures().then((f) => {
      setGuestMode(f.guestMode);
      if (f.guestMode && !new URLSearchParams(location.search).has('login')) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (initializing) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
        {guestLoggingIn && <CircularProgress size={20} />}
      </Box>
    );
  }

  const handleGuestLogin = async (): Promise<void> => {
    setGuestLoggingIn(true);
    try {
      const res = await guestLogin();
      useAuthStore.getState().loginFromGuest(res);
      navigate('/', { replace: true });
    } catch {
      setGuestLoggingIn(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await login(username, password, rememberMe);
      navigate(from, { replace: true });
    } catch {
      // error 已由 store 保存
    }
  };

  const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;

  const fieldSx = {
    width: '100%',
    background: 'transparent',
    border: 0,
    outline: 'none',
    color: 'background.default',
    fontFamily: 'inherit',
    fontSize: 20,
    letterSpacing: '0.04em',
    py: '4px',
    '&::placeholder': { color: 'rgba(242,236,221,0.35)' },
  } as const;

  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 520px' } }}>
      {/* 左：字标 + 引文 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', p: { xs: 3, md: 5 }, bgcolor: 'background.default', minHeight: { xs: 200, md: 'auto' } }}>
        <Typography
          component={RouterLink}
          to="/"
          sx={{ fontSize: { xs: 64, md: 150 }, fontWeight: 900, letterSpacing: { xs: '4px', md: '8px' }, lineHeight: 0.96, color: 'text.primary', textDecoration: 'none' }}
        >
          背字帖
        </Typography>
        <Typography sx={{ mt: { xs: 1.5, md: 2.5 }, fontSize: { xs: 12, md: 15 }, letterSpacing: '0.14em', opacity: 0.82 }}>
          逐字临写 · 按原帖顺序 · SM-2 排复习
        </Typography>

        <Box sx={{ display: { xs: 'none', md: 'block' }, mt: 'auto' }}>
          <Typography className="font-kai" sx={{ fontSize: 19, lineHeight: 1.9, letterSpacing: '0.08em', opacity: 0.72, maxWidth: 520 }}>
            「字是写出来的，不是看出来的。<br />每天二十字，一年七千字。」
          </Typography>
          <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.6, mt: 2 }}>
            v{APP_VERSION} · 1433 部碑帖 · 8 个朝代
          </Typography>
        </Box>
      </Box>

      {/* 右：墨底表单 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', bgcolor: 'text.primary', color: 'background.default', p: { xs: 3, md: 5 }, minHeight: { xs: 'auto', md: '100dvh' } }}>
        <Typography component="h1" sx={{ fontSize: 32, fontWeight: 900, letterSpacing: '0.08em' }}>
          登录
        </Typography>

        {authConfig && !authConfig.hasUsers && (
          <Box sx={{ border: '1px solid', borderColor: 'rgba(242,236,221,0.4)', p: 1.5, mt: 2 }}>
            <Typography sx={{ fontSize: 13, lineHeight: 1.7 }}>
              还没有任何账号。先{' '}
              <Link component={RouterLink} to="/register" underline="always" sx={{ color: 'inherit' }}>
                注册
              </Link>{' '}
              第一个管理员。
            </Typography>
          </Box>
        )}

        {error && (
          <Box
            component="button"
            type="button"
            onClick={clearError}
            sx={{ border: '1px solid', borderColor: 'var(--hot-ink)', color: '#ffb4a4', background: 'transparent', textAlign: 'left', p: 1.5, mt: 2, cursor: 'pointer', ...mono, fontSize: 11 }}
          >
            {error}
          </Box>
        )}

        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
          <Box sx={{ borderBottom: '1px solid rgba(242,236,221,0.38)', py: 1.25 }}>
            <Typography sx={{ ...mono, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.62 }}>
              用户名 / 邮箱
            </Typography>
            <Box
              component="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              disabled={isLoading}
              sx={{ ...fieldSx, mt: 0.75 }}
            />
          </Box>

          <Box sx={{ borderBottom: '1px solid rgba(242,236,221,0.38)', py: 1.25, position: 'relative' }}>
            <Typography sx={{ ...mono, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.62 }}>
              密码
            </Typography>
            <Box
              component="input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={isLoading}
              sx={{ ...fieldSx, mt: 0.75, pr: 6 }}
            />
            <Box
              component="button"
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              sx={{ position: 'absolute', right: 0, bottom: 6, border: 0, background: 'none', color: 'background.default', opacity: 0.6, cursor: 'pointer', ...mono, fontSize: 10 }}
            >
              {showPassword ? '隐藏' : '显示'}
            </Box>
          </Box>

          <FormControlLabel
            control={
              <Checkbox
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                size="small"
                sx={{ color: 'rgba(242,236,221,0.55)', '&.Mui-checked': { color: 'background.default' } }}
              />
            }
            label={<Typography sx={{ ...mono, fontSize: 11, opacity: 0.8 }}>记住我</Typography>}
            sx={{ mt: 1.5, ml: 0 }}
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            disabled={isLoading || !username || !password}
            sx={{
              mt: 1.5,
              height: 50,
              justifyContent: 'space-between',
              px: 2.25,
              '&.Mui-disabled': {
                backgroundColor: 'transparent',
                color: 'rgba(242,236,221,0.45)',
                border: '1px solid rgba(242,236,221,0.32)',
              },
            }}
          >
            <span>{isLoading ? '登录中…' : '登录'}</span>
            <span aria-hidden>→</span>
          </Button>
        </Box>

        {guestMode && (
          <Button
            fullWidth
            variant="outlined"
            onClick={handleGuestLogin}
            disabled={guestLoggingIn}
            sx={{
              mt: 1.25,
              height: 46,
              color: 'background.default',
              borderColor: 'rgba(242,236,221,0.6)',
              '&:hover': { backgroundColor: 'background.default', color: 'text.primary', borderColor: 'background.default' },
            }}
          >
            {guestLoggingIn ? '进入中…' : '游客浏览'}
          </Button>
        )}

        <Box sx={{ mt: 'auto', pt: 3 }}>
          <Typography sx={{ ...mono, fontSize: 11, opacity: 0.72, lineHeight: 2 }}>
            没有账号？<Link component={RouterLink} to="/register" underline="always" sx={{ color: 'inherit' }}>注册</Link>
            <br />
            忘记密码？在设置里修改，或联系管理员。
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
