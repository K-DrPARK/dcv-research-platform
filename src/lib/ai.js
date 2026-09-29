import { safeJson } from './util.js';

function extractJson(text) {
  if (typeof text !== 'string') return text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}')+1);
  return safeJson(candidate, null);
}

export async function aiJson(env, system, user, fallback) {
  if (!env.AI) return fallback;
  try {
    const model = env.AI_MODEL || '@cf/meta/llama-3.2-1b-instruct';
    const out = await env.AI.run(model, {
      messages: [
        {role:'system', content: `${system}\nReturn ONLY one valid JSON object. No markdown.`},
        {role:'user', content:user}
      ],
      max_tokens: 700,
      temperature: 0.15
    });
    const text = out?.response ?? out?.result?.response ?? JSON.stringify(out);
    return extractJson(text) || fallback;
  } catch (e) {
    return {...fallback, ai_error:String(e)};
  }
}
