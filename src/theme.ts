import type { ThemeOptions } from '@mui/material';

/**
 * 设计令牌：A1 米纸
 * 纸 #f2ecdd / 墨 #17130c / 朱砂 #c1432b。
 * 语言：2px 与 1px 硬线、直角、无阴影、等宽数字；颜色只做点色，不铺大面积。
 * 组件里不要再写 #fff / #e5e7eb 这类中性色字面量，一律走 palette 或 CSS 变量。
 */
export const ink = { light: '#17130c', dark: '#f2ecdd' } as const;
export const muted = { light: 'rgba(23, 19, 12, 0.70)', dark: 'rgba(242, 236, 221, 0.72)' } as const;
export const paper = { light: '#fbf6ea', dark: '#1d1911' } as const;
export const pageBg = { light: '#f2ecdd', dark: '#141109' } as const;
export const line = { light: 'rgba(23, 19, 12, 0.22)', dark: 'rgba(242, 236, 221, 0.24)' } as const;
export const lineStrong = { light: '#17130c', dark: '#f2ecdd' } as const;
export const vermilion = { light: '#c1432b', dark: '#e0593c' } as const;
export const vermilionDeep = { light: '#a83a25', dark: '#c14b31' } as const;
export const onVermilion = { light: '#fdf8ee', dark: '#1a120c' } as const;
/** 朱砂的小字版：在米纸上始终 ≥ 4.5:1 */
export const hotInk = { light: '#a83a25', dark: '#e8846b' } as const;

/** 标题与数字：黑体（Windows 下是 SimHei，其它平台落到 Noto Sans SC） */
export const fontDisplay = '"SimHei", "Noto Sans SC", "Microsoft YaHei", sans-serif';
/** 编号、单位、注释：等宽 */
export const fontMono = '"Consolas", "SFMono-Regular", Menlo, monospace';
/** 引文与空态：宋体 */
export const fontSerif = '"Noto Serif SC", "KaiTi", serif';

/** 弹层/浮起元素只用一层很浅的投影，不叠加层级 */
export const shadowOverlay = '0 12px 40px rgba(58, 47, 36, 0.14)';
export const shadowOverlayDark = '0 12px 40px rgba(0, 0, 0, 0.4)';

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
  const strong = lineStrong[resolvedMode];
  const hair = line[resolvedMode];

  return {
    palette: {
      mode: resolvedMode,
      primary: {
        main: vermilion[resolvedMode],
        dark: vermilionDeep[resolvedMode],
        contrastText: onVermilion[resolvedMode],
      },
      secondary: {
        main: ink[resolvedMode],
        contrastText: pageBg[resolvedMode],
      },
      background: {
        default: pageBg[resolvedMode],
        paper: paper[resolvedMode],
      },
      text: {
        primary: ink[resolvedMode],
        secondary: muted[resolvedMode],
        disabled: dark ? 'rgba(242,236,221,0.4)' : 'rgba(23,19,12,0.4)',
      },
      divider: hair,
      error: { main: hotInk[resolvedMode], contrastText: dark ? '#1a120c' : '#fdf8ee' },
    },
    typography: {
      fontFamily: fontDisplay,
      // 标题与关键数字用黑体 900；宋体只留给引文（.font-kai）
      h1: { fontFamily: fontDisplay, fontWeight: 900, letterSpacing: '0.04em' },
      h2: { fontFamily: fontDisplay, fontWeight: 900, letterSpacing: '0.04em' },
      h3: { fontFamily: fontDisplay, fontWeight: 900 },
      h4: { fontFamily: fontDisplay, fontWeight: 900 },
      h5: { fontFamily: fontDisplay, fontWeight: 900 },
      h6: { fontFamily: fontDisplay, fontWeight: 900 },
      button: { fontFamily: fontDisplay, fontWeight: 900, letterSpacing: '0.06em' },
      overline: { fontFamily: fontMono, letterSpacing: '0.16em', lineHeight: 1.6 },
      caption: { fontFamily: fontMono, letterSpacing: '0.02em' },
    },
    shape: { borderRadius: 0 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: pageBg[resolvedMode],
            WebkitFontSmoothing: 'antialiased',
            // 组件内联样式可以直接用 var(--paper) 这类令牌，深浅色自动跟随
            '--ground': pageBg[resolvedMode],
            '--paper': paper[resolvedMode],
            '--surface': dark ? '#231e15' : '#fbf6ea',
            '--ink': ink[resolvedMode],
            '--muted': muted[resolvedMode],
            '--line': hair,
            '--line-strong': strong,
            '--vermilion': vermilion[resolvedMode],
            '--hot-ink': hotInk[resolvedMode],
            '--border-color': hair,
            '--font-mono': fontMono,
          },
          '::selection': {
            backgroundColor: vermilion[resolvedMode],
            color: onVermilion[resolvedMode],
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none', borderRadius: 0 },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 0,
            border: `1px solid ${hair}`,
            boxShadow: 'none',
            overflow: 'visible',
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 0,
            textTransform: 'none',
            fontFamily: fontDisplay,
            fontWeight: 900,
            letterSpacing: '0.06em',
            minHeight: 40,
            paddingLeft: 18,
            paddingRight: 18,
            transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
          },
          sizeSmall: { fontSize: 12, minHeight: 30, paddingLeft: 12, paddingRight: 12 },
          containedPrimary: {
            '&:hover': { backgroundColor: vermilionDeep[resolvedMode] },
          },
          outlined: {
            borderWidth: 2,
            borderColor: strong,
            color: ink[resolvedMode],
            '&:hover': { borderWidth: 2, borderColor: strong, backgroundColor: ink[resolvedMode], color: pageBg[resolvedMode] },
          },
          // 禁用态不铺灰块：纸色底 + 细线 + 淡墨字
          contained: {
            '&.Mui-disabled': {
              backgroundColor: 'transparent',
              color: dark ? 'rgba(242,236,221,0.4)' : 'rgba(23,19,12,0.4)',
              border: `1px solid ${hair}`,
            },
          },
          text: {
            '&:hover': { backgroundColor: dark ? 'rgba(242,236,221,0.08)' : 'rgba(23,19,12,0.05)' },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { borderRadius: 0 },
        },
      },
      MuiListItemText: {
        styleOverrides: {
          secondary: { fontFamily: fontMono, fontSize: 11, letterSpacing: '0.02em' },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 0,
            height: 22,
            fontFamily: fontMono,
            fontSize: 10.5,
            letterSpacing: '0.04em',
          },
          sizeSmall: { height: 20, fontSize: 10 },
          outlined: { borderColor: strong, color: ink[resolvedMode] },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: { borderRadius: 0, borderRight: `2px solid ${strong}` },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 0,
            border: `2px solid ${strong}`,
            boxShadow: dark ? shadowOverlayDark : shadowOverlay,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 0,
            border: `1px solid ${strong}`,
            boxShadow: dark ? shadowOverlayDark : shadowOverlay,
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            boxShadow: 'none',
            backgroundColor: pageBg[resolvedMode],
            color: ink[resolvedMode],
            borderBottom: `2px solid ${strong}`,
          },
        },
      },
      MuiBottomNavigation: {
        styleOverrides: {
          root: {
            boxShadow: 'none',
            borderTop: `2px solid ${strong}`,
            backgroundColor: pageBg[resolvedMode],
            height: 58,
          },
        },
      },
      MuiBottomNavigationAction: {
        styleOverrides: {
          root: {
            minWidth: 0,
            padding: '6px 0 8px',
            color: muted[resolvedMode],
            fontFamily: fontMono,
            fontSize: 10,
            letterSpacing: '0.06em',
            '&.Mui-selected': { color: ink[resolvedMode] },
          },
          label: { fontFamily: fontMono, fontSize: 10, letterSpacing: '0.06em' },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            padding: '2px 10px',
            fontSize: 10.5,
            fontFamily: fontMono,
            borderRadius: 0,
            borderColor: strong,
            color: muted[resolvedMode],
            '&.Mui-selected': {
              backgroundColor: ink[resolvedMode],
              color: pageBg[resolvedMode],
              '&:hover': { backgroundColor: ink[resolvedMode] },
            },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 0,
            '&.Mui-selected': {
              backgroundColor: ink[resolvedMode],
              color: pageBg[resolvedMode],
              '&:hover': { backgroundColor: ink[resolvedMode] },
              '& .MuiListItemIcon-root': { color: pageBg[resolvedMode] },
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 0,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: hair },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1, borderColor: strong },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: { fontFamily: fontDisplay, fontSize: 13 },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: 0, height: 4, backgroundColor: hair },
          bar: { borderRadius: 0, backgroundColor: ink[resolvedMode] },
        },
      },
      MuiDivider: {
        styleOverrides: {
          root: { borderColor: hair },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 0 },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 0,
            fontFamily: fontMono,
            fontSize: 10.5,
            letterSpacing: '0.04em',
            backgroundColor: ink[resolvedMode],
            color: pageBg[resolvedMode],
          },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: { borderRadius: 0, backgroundColor: hair },
        },
      },
      MuiToolbar: {
        styleOverrides: {
          root: {
            paddingLeft: '16px !important',
            paddingRight: '16px !important',
            minHeight: '56px !important',
            '@media (min-width: 600px)': {
              minHeight: '64px !important',
            },
          },
        },
      },
    },
  };
}
