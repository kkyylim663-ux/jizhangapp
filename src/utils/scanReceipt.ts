import { OPENROUTER_API_KEY, AI_MODEL } from '../config/aiConfig';

export interface ScannedReceipt {
  amount: number | null;
  merchant: string | null;
  date: string | null; // YYYY-MM-DD
  type: 'expense' | 'income'; // AI判断这张图片是支出凭证还是收入凭证，识别不准默认expense
  suggestedCategory: string | null; // 中文分类名，例如"餐饮"或"工资"
}

const PROMPT = `你是一个记账助手。请识别这张照片（可能是消费小票/收据，也可能是工资单、转账/收款截图等收入凭证），提取以下信息，只返回JSON，不要输出任何其他文字、不要用markdown代码块包裹：
{
  "amount": 总金额的数字（不含货币符号，识别不到则为null）,
  "merchant": 商家或收款/付款方名称（识别不到则为null）,
  "date": "凭证上的日期，格式YYYY-MM-DD，识别不到则用null",
  "type": "判断这张图片记录的是一笔支出还是收入，只能是 expense 或 income 两个值之一，看不出来就用expense",
  "suggestedCategory": "如果type是expense，从这些分类里选一个最合适的中文名称：餐饮、购物、日用、交通、蔬菜、水果、零食、运动、娱乐、通讯、服饰、美容、住房、居家、数码、汽车、医疗、书籍、其他；如果type是income，从这些分类里选一个最合适的中文名称：工资、奖金、兼职、理财、红包、其他收入"
}`;

export async function scanReceipt(base64Image: string): Promise<ScannedReceipt> {
  if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY.includes('在这里')) {
    throw new Error('还没有配置API Key，请打开 src/config/aiConfig.ts 填入你的OpenRouter API Key');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI识别请求失败（状态码${response.status}）：${errText}`);
  }

  const data = await response.json();
  const rawText: string = data?.choices?.[0]?.message?.content ?? '';

  // 防御性处理：万一AI还是包了markdown代码块，把它剥掉再解析
  const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error('AI返回的内容无法解析，请换一张更清晰的照片再试一次');
  }

  return {
    amount: typeof parsed.amount === 'number' ? parsed.amount : null,
    merchant: parsed.merchant ?? null,
    date: parsed.date ?? null,
    type: parsed.type === 'income' ? 'income' : 'expense',
    suggestedCategory: parsed.suggestedCategory ?? null,
  };
}