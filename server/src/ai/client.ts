import OpenAI from 'openai';

function buildClient(): OpenAI {
  const provider = process.env.AI_PROVIDER || 'ollama';

  if (provider === 'groq') {
    return new OpenAI({
      apiKey: process.env.GROQ_API_KEY || '',
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }

  // Default: Ollama — OpenAI-compatible local inference
  return new OpenAI({
    apiKey: 'ollama', // Ollama ignores the key but the SDK requires a non-empty string
    baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  });
}

function modelName(): string {
  const provider = process.env.AI_PROVIDER || 'ollama';
  if (provider === 'groq') return process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  return process.env.OLLAMA_MODEL || 'llama3.2:3b';
}

const client = buildClient();

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export async function generateText(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 512
): Promise<string> {
  try {
    const response = await client.chat.completions.create({
      model: modelName(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
    });
    const raw = response.choices[0]?.message?.content?.trim() ?? '';
    return stripMarkdownFences(raw);
  } catch (err: any) {
    const provider = process.env.AI_PROVIDER || 'ollama';
    if (provider === 'ollama') {
      throw new Error(
        `AI unavailable: Ollama is not running. Start it with "ollama serve", or set AI_PROVIDER=groq in .env. (${err.message})`
      );
    }
    throw err;
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  // Embeddings always use Ollama nomic-embed-text regardless of AI_PROVIDER
  const embedClient = new OpenAI({
    apiKey: 'ollama',
    baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  });

  try {
    const response = await embedClient.embeddings.create({
      model: 'nomic-embed-text',
      input: text,
    });
    return response.data[0].embedding;
  } catch (err: any) {
    throw new Error(
      `Embedding unavailable: Ollama must be running with nomic-embed-text pulled. (${err.message})`
    );
  }
}
