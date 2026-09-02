import { OPENROUTER_API_KEY, AI_MODEL } from '../config/aiConfig';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * 高速语音记账版本
 *
 * 目标：
 * 1. 保留 OpenRouter API，不关闭现有 API。
 * 2. STT 改用较轻量的 Qwen3 ASR 0.6B，正常情况下优先走更快的模型。
 * 3. 如果轻量 STT 超时/失败，再自动回退到原来的 Qwen3 ASR Flash。
 * 4. 所有网络请求都有明确 timeout，避免 UI 卡 1~5 分钟。
 * 5. 保留原来的 AI_MODEL 二次账单解析。
 * 6. 输出完整耗时日志，方便继续定位。
 */

export interface VoiceAccountingResult {
  amount: number | null;
  merchant: string | null;
  date: string | null;
  type: 'expense' | 'income';
  suggestedCategory: string | null;
  note: string | null;
  transcript: string;
}

// ---------------------------------------------------------
// Models
// ---------------------------------------------------------

// OpenRouter 当前提供的轻量 Qwen3 ASR 模型。
// 正常情况下优先使用它。
const FAST_STT_MODEL = 'qwen/qwen3-asr-0.6b';

// 保留你原来的模型作为 fallback。
const FALLBACK_STT_MODEL =
  'qwen/qwen3-asr-flash-2026-02-10';

// ---------------------------------------------------------
// Timeout
// ---------------------------------------------------------

// 轻量 STT 最多等待 12 秒。
const FAST_STT_TIMEOUT_MS = 12_000;

// 原来的 Flash STT 最多等待 18 秒。
const FALLBACK_STT_TIMEOUT_MS = 18_000;

// AI 财务解析最多等待 15 秒。
const AI_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------
// Prompt
// ---------------------------------------------------------

const PROMPT = `你是一个中文个人记账助手。

用户会说一句或几句自然语言，例如：
“今天午饭花了35块，在麦当劳”
“昨天收到工资5000”
“8月30号买衣服花了199块”

请从用户说的话中提取记账信息。

只返回JSON，不要输出任何其他文字，不要使用markdown代码块。

{
  "amount": 数字，不含货币符号，识别不到则为null,
  "merchant": 商家、付款方或收款方，识别不到则为null,
  "date": 日期，格式YYYY-MM-DD；如果用户没有说日期则使用今天的日期；无法判断则为null,
  "type": 只能是 expense 或 income；没有明确说明时默认expense,
  "suggestedCategory": 如果type是expense，从这些分类里选择最合适的一个：餐饮、购物、日用、交通、蔬菜、水果、零食、运动、娱乐、通讯、服饰、美容、住房、居家、数码、汽车、医疗、书籍、其他；如果type是income，从这些分类里选择最合适的一个：工资、奖金、兼职、理财、红包、其他收入,
  "note": 简短备注；如果merchant存在，可以优先使用商家名；否则根据原话生成简短备注；没有则null
}`;

function getToday(): string {
  const d = new Date();

  return `${d.getFullYear()}-${String(
    d.getMonth() + 1,
  ).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function cleanJson(raw: string): string {
  return raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

// ---------------------------------------------------------
// Debug
// ---------------------------------------------------------

function debug(
  startedAt: number,
  label: string,
) {
  const seconds = (
    (Date.now() - startedAt) /
    1000
  ).toFixed(2);

  console.log(
    `[VOICE FAST][${seconds}s] ${label}`,
  );
}

// ---------------------------------------------------------
// Timeout fetch
// ---------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  label: string,
  startedAt: number,
): Promise<Response> {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    console.warn(
      `[VOICE FAST] ⚠️ ${label} 超时 ${timeoutMs / 1000}s，主动中止请求`,
    );

    controller.abort();
  }, timeoutMs);

  try {
    debug(
      startedAt,
      `${label} fetch START`,
    );

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    debug(
      startedAt,
      `${label} fetch END HTTP ${response.status}`,
    );

    return response;
  } catch (error: any) {
    if (
      error?.name === 'AbortError' ||
      controller.signal.aborted
    ) {
      throw new Error(
        `${label} 超时（>${timeoutMs / 1000}秒）`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------
// Local audio -> Base64
// ---------------------------------------------------------

async function fileToBase64(
  uri: string,
  startedAt: number,
): Promise<string> {
  debug(
    startedAt,
    '开始读取本地音频',
  );

  const fileStartedAt = Date.now();

  const base64 =
    await FileSystem.readAsStringAsync(
      uri,
      {
        encoding:
          FileSystem.EncodingType.Base64,
      },
    );

  const seconds = (
    (Date.now() - fileStartedAt) /
    1000
  ).toFixed(2);

  debug(
    startedAt,
    `Base64 完成 ${seconds}s，长度=${base64.length.toLocaleString()}`,
  );

  return base64;
}

// ---------------------------------------------------------
// STT
// ---------------------------------------------------------

async function transcribeWithModel(
  base64Audio: string,
  format: string,
  model: string,
  timeoutMs: number,
  label: string,
  startedAt: number,
): Promise<string> {
  debug(
    startedAt,
    `${label} START model=${model}`,
  );

  const requestStartedAt = Date.now();

  const response =
    await fetchWithTimeout(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:
            `Bearer ${OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          input_audio: {
            data: base64Audio,
            format,
          },
          language: 'zh',
          temperature: 0,
          max_tokens: 128,
        }),
      },
      timeoutMs,
      label,
      startedAt,
    );

  const networkSeconds = (
    (Date.now() - requestStartedAt) /
    1000
  ).toFixed(2);

  console.log(
    `[VOICE FAST] ${label} 网络耗时=${networkSeconds}s`,
  );

  const generationId =
    response.headers.get(
      'x-generation-id',
    );

  if (generationId) {
    console.log(
      `[VOICE FAST] ${label} generation_id=${generationId}`,
    );
  }

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `${label} 失败 HTTP ${response.status}: ${errorText}`,
    );
  }

  const jsonStartedAt = Date.now();

  const data =
    await response.json();

  console.log(
    `[VOICE FAST] ${label} JSON耗时=${(
      (Date.now() - jsonStartedAt) /
      1000
    ).toFixed(2)}s`,
  );

  const text = String(
    data?.text ?? '',
  ).trim();

  if (!text) {
    throw new Error(
      `${label} 没有识别到语音内容`,
    );
  }

  debug(
    startedAt,
    `${label} RESULT: ${text}`,
  );

  return text;
}

async function transcribeAudio(
  base64Audio: string,
  format: string,
  startedAt: number,
): Promise<string> {
  // -------------------------------------------------------
  // 第一优先：轻量 Qwen3 ASR 0.6B
  // -------------------------------------------------------

  try {
    return await transcribeWithModel(
      base64Audio,
      format,
      FAST_STT_MODEL,
      FAST_STT_TIMEOUT_MS,
      'FAST STT',
      startedAt,
    );
  } catch (error: any) {
    console.warn(
      '[VOICE FAST] ⚠️ FAST STT 失败，切换原来的 Flash STT：',
      error?.message ?? error,
    );

    debug(
      startedAt,
      'FAST STT failed -> fallback',
    );
  }

  // -------------------------------------------------------
  // 第二优先：你原来的 Qwen3 ASR Flash
  // -------------------------------------------------------

  return transcribeWithModel(
    base64Audio,
    format,
    FALLBACK_STT_MODEL,
    FALLBACK_STT_TIMEOUT_MS,
    'FALLBACK STT',
    startedAt,
  );
}

// ---------------------------------------------------------
// AI accounting parser
// ---------------------------------------------------------

async function parseAccountingText(
  transcript: string,
  startedAt: number,
): Promise<
  Omit<VoiceAccountingResult, 'transcript'>
> {
  debug(
    startedAt,
    `AI 财务解析 START，transcript=${transcript.length} chars`,
  );

  const response =
    await fetchWithTimeout(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:
            `Bearer ${OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: AI_MODEL,

          // 不需要随机性。
          temperature: 0,

          // 记账 JSON 很短，限制输出可以避免模型生成多余内容。
          max_tokens: 220,

          messages: [
            {
              role: 'user',
              content:
                `${PROMPT}\n\n` +
                `今天的日期是：${getToday()}\n\n` +
                `用户语音转写内容：\n${transcript}`,
            },
          ],
        }),
      },
      AI_TIMEOUT_MS,
      'AI PARSER',
      startedAt,
    );

  const generationId =
    response.headers.get(
      'x-generation-id',
    );

  if (generationId) {
    console.log(
      `[VOICE FAST] AI generation_id=${generationId}`,
    );
  }

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `AI记账解析失败（状态码${response.status}）：${errorText}`,
    );
  }

  const data =
    await response.json();

  const rawText = String(
    data?.choices?.[0]?.message?.content ??
      '',
  );

  debug(
    startedAt,
    `AI 原始返回=${rawText.length} chars`,
  );

  const cleaned =
    cleanJson(rawText);

  let parsed: any;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error(
      '[VOICE FAST] AI 原始返回无法解析：',
      rawText,
    );

    throw new Error(
      'AI返回的记账结果无法解析，请再说一次',
    );
  }

  return {
    amount:
      typeof parsed.amount === 'number'
        ? parsed.amount
        : null,

    merchant:
      parsed.merchant ?? null,

    date:
      parsed.date ?? null,

    type:
      parsed.type === 'income'
        ? 'income'
        : 'expense',

    suggestedCategory:
      parsed.suggestedCategory ??
      null,

    note:
      parsed.note ??
      parsed.merchant ??
      null,
  };
}

// ---------------------------------------------------------
// Public API
// ---------------------------------------------------------

export async function voiceToAccounting(
  uri: string,
): Promise<VoiceAccountingResult> {
  const startedAt = Date.now();

  console.log(
    '\n[VOICE FAST] ========================================',
  );
  console.log(
    '[VOICE FAST] voiceToAccounting START',
  );
  console.log(
    '[VOICE FAST] ========================================',
  );

  try {
    if (
      !OPENROUTER_API_KEY ||
      OPENROUTER_API_KEY.includes('在这里')
    ) {
      throw new Error(
        '还没有配置API Key，请打开 src/config/aiConfig.ts 填入你的OpenRouter API Key',
      );
    }

    debug(
      startedAt,
      'API Key 检查通过',
    );

    const base64Audio =
      await fileToBase64(
        uri,
        startedAt,
      );

    const format =
      uri.toLowerCase().endsWith('.wav')
        ? 'wav'
        : 'm4a';

    debug(
      startedAt,
      `音频格式=${format}`,
    );

    // -------------------------------------------------------
    // STT
    // -------------------------------------------------------

    const transcript =
      await transcribeAudio(
        base64Audio,
        format,
        startedAt,
      );

    debug(
      startedAt,
      'STT 完成，开始 AI 财务解析',
    );

    // -------------------------------------------------------
    // AI parser
    // -------------------------------------------------------

    const parsed =
      await parseAccountingText(
        transcript,
        startedAt,
      );

    const totalSeconds = (
      (Date.now() - startedAt) /
      1000
    ).toFixed(2);

    console.log(
      `[VOICE FAST] ✅ TOTAL=${totalSeconds}s`,
    );

    console.log(
      '[VOICE FAST] ========================================\n',
    );

    return {
      ...parsed,
      transcript,
    };
  } catch (error: any) {
    const totalSeconds = (
      (Date.now() - startedAt) /
      1000
    ).toFixed(2);

    console.error(
      `[VOICE FAST] ❌ FAILED after ${totalSeconds}s`,
      error,
    );

    console.log(
      '[VOICE FAST] ========================================\n',
    );

    throw error;
  }
}
