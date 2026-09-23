import { OPENROUTER_API_KEY, AI_MODEL } from '../config/aiConfig';
import * as FileSystem from 'expo-file-system/legacy';

export interface VoiceAccountingResult {
  amount: number | null;
  merchant: string | null;
  date: string | null;
  type: 'expense' | 'income';
  suggestedCategory: string | null;
  note: string | null;
  transcript: string;
}

const STT_MODEL = 'qwen/qwen3-asr-flash-2026-02-10';

// 请求超时熔断：8 秒没响应就中断，不让请求无限挂起
const REQUEST_TIMEOUT_MS = 8000;

function withTimeout(): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

// 把 AbortError 转成给用户看的明确文案
function toUserError(err: unknown): unknown {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new Error('请求超时，请重试');
  }
  return err;
}

const PROMPT = `你是一个中文个人记账助手。
用户会说一句或几句自然语言，例如：
“今天午饭花了35块，在麦当劳”
“昨天收到工资5000”
“8月30号买衣服花了199块”

请从用户说的话中提取记账信息，只返回JSON，不要输出任何其他文字，不要使用markdown代码块：
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cleanJson(raw: string): string {
  return raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function fileToBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

// 注意：OpenRouter 官方文档明确 STT 端点不支持 provider 路由偏好
// （order/only/ignore/sort 均对 transcription 请求无效；provider 对象只收 provider.options 透传参数），
// 所以这里不能加 sort: "latency"——选供应商只能靠 model slug 本身。
// 文档：openrouter.ai/docs/guides/overview/multimodal/stt.md
async function transcribeAudio(base64Audio: string, format: string, model: string = STT_MODEL): Promise<string> {
  const { signal, clear } = withTimeout();
  try {
    const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      signal,
      body: JSON.stringify({
        model,
        input_audio: {
          data: base64Audio,
          format,
        },
        language: 'zh',
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`语音识别失败（状态码${response.status}）：${errText}`);
    }

    const data = await response.json();
    const text = String(data?.text ?? '').trim();
    if (!text) throw new Error('没有识别到语音内容，请再说一次');
    return text;
  } catch (err) {
    throw toUserError(err);
  } finally {
    clear();
  }
}

async function parseAccountingText(transcript: string): Promise<Omit<VoiceAccountingResult, 'transcript'>> {
  const { signal, clear } = withTimeout();
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      signal,
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0,
        // OpenRouter provider routing（chat 端点支持）：优先延迟低的供应商
        provider: { sort: 'latency' },
        messages: [
          {
            role: 'user',
            content: `${PROMPT}\n\n今天的日期是：${getToday()}\n\n用户语音转写内容：\n${transcript}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI记账解析失败（状态码${response.status}）：${errText}`);
    }

    const data = await response.json();
    const rawText = String(data?.choices?.[0]?.message?.content ?? '');
    const cleaned = cleanJson(rawText);

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error('AI返回的记账结果无法解析，请再说一次');
    }

    return {
      amount: typeof parsed.amount === 'number' ? parsed.amount : null,
      merchant: parsed.merchant ?? null,
      date: parsed.date ?? null,
      type: parsed.type === 'income' ? 'income' : 'expense',
      suggestedCategory: parsed.suggestedCategory ?? null,
      note: parsed.note ?? parsed.merchant ?? null,
    };
  } catch (err) {
    throw toUserError(err);
  } finally {
    clear();
  }
}

export async function voiceToAccounting(uri: string): Promise<VoiceAccountingResult> {
  if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY.includes('在这里')) {
    throw new Error('还没有配置API Key，请打开 src/config/aiConfig.ts 填入你的OpenRouter API Key');
  }

  const base64Audio = await fileToBase64(uri);
  const format = uri.toLowerCase().endsWith('.wav') ? 'wav' : 'm4a';
  const transcript = await transcribeAudio(base64Audio, format);
  const parsed = await parseAccountingText(transcript);

  return {
    ...parsed,
    transcript,
  };
}

/**
 * 只做语音转写（云端ASR），不做记账解析。
 * 给本地AI路径用：端侧模型只负责"文字→结构化"，语音→文字这步目前只有云端能做。
 * 转写失败由调用方捕获后整体降级 voiceToAccounting()。
 */
export async function transcribeAudioFile(uri: string): Promise<string> {
  if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY.includes('在这里')) {
    throw new Error('还没有配置API Key，请打开 src/config/aiConfig.ts 填入你的OpenRouter API Key');
  }
  const base64Audio = await fileToBase64(uri);
  const format = uri.toLowerCase().endsWith('.wav') ? 'wav' : 'm4a';
  return transcribeAudio(base64Audio, format);
}
