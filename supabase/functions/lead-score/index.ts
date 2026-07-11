import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';

const API_ENDPOINT = 'https://app-chfyozakqsqp-api-VaOwP8E7dJqa.gateway.appmedo.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

interface LeadData {
  name?: string;
  phone?: string;
  email?: string;
  interestType?: string;
  propertyType?: string;
  preferredProject?: string;
  budgetRange?: string;
  purpose?: string;
  leadSource?: string;
  currentLocation?: string;
  remarks?: string;
}

function buildPrompt(lead: LeadData): string {
  return `You are a real estate CRM AI scoring assistant. Analyze the following lead data and score it as A, B, or C based on buying intent, budget clarity, urgency, and source quality.

Scoring criteria:
- A (Hot/Ready): Clear budget, urgent timeline, high-quality source, specific project interest, ready to view/buy
- B (Warm/Considering): Moderate budget range, some urgency, considering options, needs follow-up
- C (Cold/Inquiring): Vague budget, no urgency, just browsing, low-quality source

Lead data:
${JSON.stringify(lead, null, 2)}

Respond ONLY in this exact JSON format (no markdown, no extra text):
{"score":"A|B|C","reasoning":"brief reason in Myanmar language"}`;
}

async function callGemini(prompt: string, apiKey: string): Promise<{ score: string; reasoning: string }> {
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
  };

  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gateway-Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Gemini API error ${response.status}: ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(dataStr);
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) fullText += text;
      } catch {
        // skip malformed lines
      }
    }
  }

  // Extract JSON from response
  const jsonMatch = fullText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse AI response: ' + fullText.slice(0, 200));
  }

  const result = JSON.parse(jsonMatch[0]);
  return {
    score: String(result.score || 'C').trim().toUpperCase(),
    reasoning: String(result.reasoning || 'No reasoning provided.'),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    const apiKey = Deno.env.get('INTEGRATIONS_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const { lead } = await req.json();
    if (!lead) {
      return new Response(
        JSON.stringify({ error: 'Missing lead data' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const prompt = buildPrompt(lead);
    const result = await callGemini(prompt, apiKey);

    // Map to full level string
    const levelMap: Record<string, string> = {
      'A': 'Level A (Hot/Ready)',
      'B': 'Level B (Warm/Considering)',
      'C': 'Level C (Cold/Inquiring)',
    };

    return new Response(
      JSON.stringify({
        score: result.score,
        level: levelMap[result.score] || levelMap['C'],
        reasoning: result.reasoning,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
});
