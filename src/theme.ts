import type { ThemeOptions } from '@mui/material';

/**
 * 设计令牌（纸墨朱红）
 * 与小红书小工具的帖页语言同源：纸白/墨/朱红 + 1px 细线 + 2px 直角。
 * 组件里不要再写 #fff / #e5e7eb 这类中性色字面量，一律走 palette 或这里的变量。
 */
export const ink = { light: '#302c25', dark: '#e9e3d6' } as const;
export const muted = { light: '#6e6458', dark: '#a89e8e' } as const;
export const paper = { light: '#fcfaf5', dark: '#232019' } as const;
export const pageBg = { light: '#f5f1e9', dark: '#1b1916' } as const;
export const line = { light: '#d7cec0', dark: '#3a342b' } as const;
export const lineStrong = { light: '#b9ad99', dark: '#4a4236' } as const;
export const vermilion = { light: '#8b3a30', dark: '#b85744' } as const;
export const vermilionDeep = { light: '#6f2e26', dark: '#9b4635' } as const;
export const onVermilion = { light: '#fff8ef', dark: '#fff3ea' } as const;

/** 弹层/浮起元素只用一层很浅的投影，不叠加层级 */
export const shadowOverlay = '0 12px 40px rgba(58,47,36,0.14)';
export const shadowOverlayDark = '0 12px 40px rgba(0,0,0,0.35)';

export function getShadowBorder(mode: 'light' | 'dark'): string {
  return `0 0 0 1px ${line[mode]}`;
}

export function getShadowCard(): string {
  return 'none';
}

export function getShadowElevated(mode: 'light' | 'dark'): string {
  return mode === 'dark' ? shadowOverlayDark : shadowOverlay;
}

export function buildThemeOptions(resolvedMode: 'light' | 'dark'): ThemeOptions {
  const dark = resolvedMode === 'dark';
  const border = line[resolvedMode];

  return {
    palette: {
      mode: resolvedMode,
      primary: {
        main: vermilion[resolvedMode],
        dark: vermilionDeep[resolvedMode],
        contrastText: onVermilion[resolvedMode],
      },
      secondary: {
        main: dark ? '#b9ad99' : '#6e6458',
        contrastText: dark ? '#1b1916' : '#fcfaf5',
      },
      background: {
        default: pageBg[resolvedMode],
        paper: paper[resolvedMode],
      },
      text: {
        primary: ink[resolvedMode],
        secondary: muted[resolvedMode],
        disabled: dark ? '#7a7364' : '#948a7c',
      },
      divider: border,
      // 危险操作沿用朱红家族，避免页面里出现第二种红
      error: { main: dark ? '#d4725f' : '#a1352a' },
    },
    typography: {
      fontFamily: [
        '"Noto Sans SC"',
        '"Microsoft YaHei"',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ].join(','),
      // 帖名、标题、关键数字一律宋体；正文保持黑体
      h1: { fontFamily: '"Noto Serif SC", "楷体", KaiTi, serif' },
      h2: { fontFamily: '"Noto Serif SC", "楷体", KaiTi, serif', fontWeight: 400 },
      h3: { fontFamily: '"Noto Serif SC", "楷体", KaiTi, serif', fontWeight: 400 },
      h4: { fontFamily: '"Noto Serif SC", "楷体", KaiTi, serif', fontWeight: 400 },
      h5: { fontFamily: '"Noto Serif SC", "楷体", KaiTi, serif', fontWeight: 400 },
      h6: { fontFamily: '"Noto Serif SC", "楷体", KaiTi, serif', fontWeight: 400 },
    },
    shape: { borderRadius: 2 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            // 组件内联样式可以直接用 var(--paper) 这类令牌，深浅色自动跟随
            '--paper': paper[resolvedMode],
            '--surface': dark ? '#2a2620' : '#f2ece1',
            '--ink': ink[resolvedMode],
            '--muted': muted[resolvedMode],
            '--line': border,
            '--line-strong': lineStrong[resolvedMode],
            '--vermilion': vermilion[resolvedMode],
            '--border-color': border,
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            borderRadius: 2,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            border: `1px solid ${border}`,
            boxShadow: 'none',
            overflow: 'visible',
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 2,
            textTransform: 'none',
            transition: 'background-color 0.15s ease, border-color 0.15s ease',
            fontWeight: 500,
            minHeight: 40,
          },
          sizeSmall: { fontSize: 12, padding: '4px 12px', minHeight: 30 },
          containedPrimary: {
            '&:hover': { backgroundColor: vermilionDeep[resolvedMode] },
          },
          // 禁用态不铺灰块：纸色底 + 细线 + 淡墨字，和小工具的按钮规范一致
          contained: {
            '&.Mui-disabled': {
              backgroundColor: dark ? '#2a261f' : '#efe7db',
              color: dark ? '#8d8474' : '#7b7263',
              border: `1px solid ${border}`,
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            fontSize: 12,
            height: 28,
          },
          sizeSmall: {
            fontSize: 11,
            height: 24,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            borderTopLeftRadius: 2,
            borderTopRightRadius: 2,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 2,
            border: `1px solid ${border}`,
            boxShadow: dark ? shadowOverlayDark : shadowOverlay,
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            boxShadow: 'none',
            borderBottom: `1px solid ${border}`,
          },
        },
      },
      MuiBottomNavigation: {
        styleOverrides: {
          root: {
            boxShadow: 'none',
            borderTop: `1px solid ${border}`,
            backgroundColor: paper[resolvedMode],
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            padding: '4px 12px',
            fontSize: 12,
            borderRadius: 2,
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            '&.Mui-selected': {
              backgroundColor: 'primary.main',
              color: 'primary.contrastText',
              '&:hover': { backgroundColor: 'primary.dark' },
              '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: border },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1, borderColor: vermilion[resolvedMode] },
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: 1, height: 4 },
          bar: { borderRadius: 1 },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 2 },
        },
      },
      MuiToolbar: {
        styleOverrides: {
          root: {
            paddingLeft: '16px !important',
            paddingRight: '16px !important',
            minHeight: '48px !important',
            '@media (min-width: 600px)': {
              minHeight: '48px !important',
            },
          },
        },
      },
    },
  };
}
