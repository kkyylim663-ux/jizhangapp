// ⚠️ 重要安全提示 ⚠️
// 这个文件里的API Key会被打包进APP安装包，理论上懂技术的人可以从APP里把它提取出来盗用，
// 从而消耗你的API额度产生费用。
//
// 现阶段（自己测试、小范围使用）先这样做没问题，但如果之后要正式上架给很多人用，
// 强烈建议把这个API调用改成"经过你自己的服务器中转"，而不是让APP直接带着密钥去调用，
// 到时候可以再来找我，我帮你把这部分改造成后端代理的方式。

// 去 https://openrouter.ai/keys 复制你的API Key，粘贴到下面双引号里
export const OPENROUTER_API_KEY = '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';

// OpenRouter上Claude模型的名称，可以去 https://openrouter.ai/models 搜索"claude"确认当前可用的模型名称
// 常见写法示例（具体以OpenRouter平台当前列出的为准）：
export const AI_MODEL = 'anthropic/claude-sonnet-4.5';
