import { useState } from 'react';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import { Box, Button, Typography, Link, Checkbox, FormControlLabel } from '@mui/material';
import { useAuthStore } from '@/stores/useAuthStore';
import { APP_VERSION } from '@/core/version';

/** 注册：与登录同一套对开版式，右侧墨底表单 */
export default function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { register, isLoading, error, clearError } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agree, setAgree] = useState(true);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await register(username, password);
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
  } as const;

  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 520px' } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', p: { xs: 3, md: 5 }, bgcolor: 'background.default' }}>
        <Typography
          component={RouterLink}
          to="/"
          sx={{ fontSize: { xs: 64, md: 150 }, fontWeight: 900, letterSpacing: { xs: '4px', md: '8px' }, lineHeight: 0.96, color: 'text.primary', textDecoration: 'none' }}
        >
          背字帖
        </Typography>
        <Typography sx={{ mt: { xs: 1.5, md: 2.5 }, fontSize: { xs: 12, md: 15 }, letterSpacing: '0.14em', opacity: 0.82 }}>
          建一个账号 · 学习记录跟着你走
        </Typography>
        <Box sx={{ display: { xs: 'none', md: 'block' }, mt: 'auto' }}>
          <Typography className="font-kai" sx={{ fontSize: 19, lineHeight: 1.9, letterSpacing: '0.08em', opacity: 0.72, maxWidth: 520 }}>
            「临帖不在多，在把一帖写透。<br />先把字形记住，再谈笔意。」
          </Typography>
          <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.6, mt: 2 }}>v{APP_VERSION} · 云端同步 · 可离线</Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', bgcolor: 'text.primary', color: 'background.default', p: { xs: 3, md: 5 }, minHeight: { xs: 'auto', md: '100dvh' } }}>
        <Typography component="h1" sx={{ fontSize: 32, fontWeight: 900, letterSpacing: '0.08em' }}>
          注册
        </Typography>
        <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.68, mt: 1 }}>
          用户名与密码即可 · 建议 8 位以上
        </Typography>

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
              用户名
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
              autoComplete="new-password"
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
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                size="small"
                sx={{ color: 'rgba(242,236,221,0.55)', '&.Mui-checked': { color: 'background.default' } }}
              />
            }
            label={<Typography sx={{ ...mono, fontSize: 11, opacity: 0.8 }}>我明白数据会同步到云端</Typography>}
            sx={{ mt: 1.5, ml: 0 }}
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            disabled={isLoading || !username || !password || !agree}
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
            <span>{isLoading ? '创建中…' : '创建账号'}</span>
            <span aria-hidden>→</span>
          </Button>
        </Box>

        <Box sx={{ mt: 'auto', pt: 3 }}>
          <Typography sx={{ ...mono, fontSize: 11, opacity: 0.72, lineHeight: 2 }}>
            已有账号？<Link component={RouterLink} to="/login" underline="always" sx={{ color: 'inherit' }}>登录</Link>
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
