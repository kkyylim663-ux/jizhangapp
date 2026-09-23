/**
 * STT 模型对比测试脚本（临时，不属于正式代码路径）
 *
 * 用同一段本地音频文件，对两个模型各跑 N 次 OpenRouter 语音转写，
 * 打印每次耗时（ms）和识别文本，最后输出平均耗时汇总——人工对比准确率和速度用。
 *
 * 用法：
 *   npx tsx scripts/test-stt-models.ts <音频文件路径> [每模型次数=5]
 *   例：npx tsx scripts/test-stt-models.ts ./test-audio/voice.m4a
 *
 * 跑完不会自动改 STT_MODEL，结果人工看。
 * API Key：优先环境变量 OPENROUTER_API_KEY，其次读 src/config/aiConfig.ts 里已填的值。
 */

import * as fs from 'fs';
import * as path from 'path';

const MODELS = ['qwen/qwen3-asr-flash-2026-02-10', 'openai/whisper-large-v3-turbo'];
const DEFAULT_RUNS = 5;
const TIMEOUT_MS = 8000;

function loadApiKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const cfg = fs.readFileSync('src/config/aiConfig.ts', 'utf-8');
  const m = cfg.match(/OPENROUTER_API_KEY\s*=\s*['"]([^'"]+)['"]/);
  if (m && m[1] && !m[1].includes('在这里')) return m[1];
  throw new Error('找不到 OpenRouter API Key：设 OPENROUTER_API_KEY 环境变量，或确认 src/config/aiConfig.ts 已填');
}

function extToFormat(p: string): string {
  const ext = p.toLowerCase().split('.').pop() ?? '';
  const known = ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'webm', 'aac'];
  if (!known.includes(ext)) throw new Error(`不支持的音频格式 .${ext}（支持 wav/mp3/flac/m4a/ogg/webm/aac）`);
  return ext;
}

// 单次转写：与应用内 transcribeAudio 同一套请求体 + 8s 熔断
async function transcribeOnce(apiKey: string, model: string, base64Audio: string, format: string): Promise<{ ms: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        input_audio: { data: base64Audio, format },
        language: 'zh',
        temperature: 0,
      }),
    });
    const ms = Date.now() - startedAt;
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }
    const data = await response.json();
    return { ms, text: String(data?.text ?? '').trim() };
  } catch (err: any) {
    const ms = Date.now() - startedAt;
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ms, text: '【超时：请求超时，请重试】' };
    }
    return { ms, text: `【失败】${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const audioPath = process.argv[2];
  const runs = Number(process.argv[3] ?? DEFAULT_RUNS);
  if (!audioPath) {
    console.error('用法：npx tsx scripts/test-stt-models.ts <音频文件路径> [每模型次数]');
    process.exit(1);
  }
  // 路径安全：规范化后禁止路径穿越（..），只允许读本项目目录内的音频
  const resolved = path.resolve(audioPath);
  const projectRoot = path.resolve('.');
  if (!resolved.startsWith(projectRoot + path.sep) || audioPath.includes('..')) {
    console.error('拒绝读取：音频路径必须在项目目录内（不允许 .. 或项目外的文件）');
    process.exit(1);
  }
  if (!fs.existsSync(resolved)) {
    console.error(`音频文件不存在：${audioPath}`);
    process.exit(1);
  }
  const apiKey = loadApiKey();
  const format = extToFormat(audioPath);
  const base64Audio = fs.readFileSync(resolved).toString('base64');
  console.log(`音频：${audioPath}（format=${format}, ${(base64Audio.length * 0.75 / 1024).toFixed(1)}KB）`);
  console.log(`每模型 ${runs} 次，超时 ${TIMEOUT_MS}ms`);
  console.log('='.repeat(64));

  for (const model of MODELS) {
    const okTimes: number[] = [];
    let okCount = 0;
    console.log(`\n【${model}】`);
    for (let i = 1; i <= runs; i++) {
      const { ms, text } = await transcribeOnce(apiKey, model, base64Audio, format);
      const failed = text.startsWith('【');
      if (!failed) {
        okCount += 1;
        okTimes.push(ms);
      }
      console.log(`  第${i}次  ${String(ms).padStart(6)}ms  ${failed ? text : JSON.stringify(text)}`);
    }
    const avg = okTimes.length ? Math.round(okTimes.reduce((a, b) => a + b, 0) / okTimes.length) : 0;
    const best = okTimes.length ? Math.min(...okTimes) : 0;
    console.log(`  → 成功 ${okCount}/${runs}，平均 ${avg}ms${okTimes.length ? `，最快 ${Math.min(...okTimes)}ms，最慢 ${Math.max(...okTimes)}ms` : ''}`);
  }
  console.log('='.repeat(64));
  console.log('对比完请人工决定用哪个模型；本脚本不会改 STT_MODEL。');
}

main();
