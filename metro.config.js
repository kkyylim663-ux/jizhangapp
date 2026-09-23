// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Expo 的 metro-file-map fork 默认 useWatchman=false，没有 watchman 时会退回
// FallbackWatcher——它在 Windows 上监听到临时文件（如 .mimosa 的会话锁）被删除时
// 会抛 ENOENT 使整个 dev server 崩溃。本机已安装 watchman，这里显式启用。
config.resolver.useWatchman = true;

module.exports = config;
