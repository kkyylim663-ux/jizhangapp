// useSystemColorScheme.ts
// 实时系统外观（'light' | 'dark'）—— Auto（跟随系统）模式下所有主题解析的唯一来源。
//
// 为什么不用 RN 自带的 useColorScheme()：
//   在 react-native-web 下它的返回值**不会跟随系统变化**（2026-10-09 实测：matchMedia 会触发、
//   Appearance.getColorScheme() 会更新、连 Appearance.addChangeListener 的回调都会响，
//   但该 hook 的返回值始终停在 App 启动时的值）→ Auto 模式必须重启 App 才生效。
//   所以这里自己订阅三路来源，任何一路变了就 setState，保证立刻重渲染：
//     ① Appearance.addChangeListener（原生 iOS / Android 换系统外观走这里）
//     ② web 上额外直接订阅 matchMedia('(prefers-color-scheme: dark)') 的 change（拿最新 API，绕开 RNW 的兼容层）
//     ③ AppState 回前台时重读一次（安卓开省电模式会在后台切系统深色，回前台必须立刻生效）
//
// 本 hook 不依赖任何 Provider，App 根组件的启动占位页也可以直接用。

import { useEffect, useState } from 'react';
import { AppState, Appearance, Platform } from 'react-native';

type ColorScheme = 'light' | 'dark';

const readScheme = (): ColorScheme => (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');

export function useSystemColorScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>(readScheme);

  useEffect(() => {
    const sync = () => setScheme(readScheme());

    // 挂载后立刻对齐一次：首帧读到的值可能与真实值差一帧
    sync();

    const appearanceSub = Appearance.addChangeListener(sync);

    let media: MediaQueryList | undefined;
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      media = window.matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener('change', sync);
    }

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });

    return () => {
      appearanceSub.remove();
      if (media) media.removeEventListener('change', sync);
      appStateSub.remove();
    };
  }, []);

  return scheme;
}
