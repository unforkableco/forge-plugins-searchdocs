/**
 * Search Docs Plugin Service
 * 
 * Docker container that provides OpenSCAD documentation search using
 * OpenAI's Assistants API with Vector Store (file search).
 * 
 * API Endpoints:
 * - GET /health - Health check
 * - POST /search_docs - Execute documentation search
 * 
 * Environment Variables:
 * - OPENAI_API_KEY - OpenAI API key (passed from backend)
 * - OPENSCAD_VECTOR_STORE_ID - Vector store ID for documentation
 * - PORT - Server port (default: 8080)
 */

import express from 'express';
import OpenAI from 'openai';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Cache for search results
const searchCache = new Map<string, { result: any; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Singleton assistant ID
let searchAssistantId: string | null = null;
let searchAssistantVectorStoreId: string | null = null;

interface SearchDocsRequest {
  context: {
    sessionId: string;
    projectId?: string;
    accountId: string;
    step: number;
  };
  args: {
    query: string;
    context?: string;
  };
}

interface PluginResult {
  ok: boolean;
  tokensUsed: number;
  artifacts: any[];
  result: string;
  error?: string;
}

/**
 * Ensure the search assistant exists
 */
async function ensureSearchAssistant(vectorStoreId: string, openai: OpenAI): Promise<string> {
  if (searchAssistantId && searchAssistantVectorStoreId === vectorStoreId) {
    return searchAssistantId;
  }

  const assistantName = 'OpenSCAD Documentation Search';

  // Check for existing assistant
  const assistants = await openai.beta.assistants.list({ limit: 100 });
  const existing = assistants.data.find(a => a.name === assistantName);

  if (existing) {
    searchAssistantId = existing.id;
    searchAssistantVectorStoreId = vectorStoreId;
    console.log(`Found existing search assistant: ${existing.id}`);
    return existing.id;
  }

  // Create new assistant
  console.log(`Creating search assistant with vector store: ${vectorStoreId}`);
  const assistant = await openai.beta.assistants.create({
    name: assistantName,
    model: 'gpt-4o',
    instructions: `You are a documentation search assistant for OpenSCAD and its libraries (BOSL2, threads-scad, etc.).

When a user searches for documentation:
1. Search the vector store for relevant documentation
2. Return a structured JSON response with:
   - signature: The function/module signature
   - parameters: Parameter descriptions
   - examples: Code examples
   - notes: Important usage notes
   - sources: Array of source references

Always respond with valid JSON only. No markdown, no explanations outside the JSON.`,
    tools: [{ type: 'file_search' }],
    tool_resources: {
      file_search: {
        vector_store_ids: [vectorStoreId]
      }
    }
  });

  searchAssistantId = assistant.id;
  searchAssistantVectorStoreId = vectorStoreId;
  console.log(`Created search assistant: ${assistant.id}`);
  return assistant.id;
}

/**
 * Execute documentation search
 */
async function executeSearch(query: string, context?: string): Promise<{ answer: any; tokensUsed: number }> {
  const vectorStoreId = process.env.OPENSCAD_VECTOR_STORE_ID;

  if (!vectorStoreId) {
    return {
      answer: {
        signature: 'Vector store not configured',
        parameters: 'OPENSCAD_VECTOR_STORE_ID environment variable is required',
        examples: '',
        notes: 'Configure the vector store to enable documentation search',
        sources: []
      },
      tokensUsed: 0
    };
  }

  if (!query.trim()) {
    return {
      answer: {
        signature: 'Query is required',
        parameters: '',
        examples: '',
        notes: '',
        sources: []
      },
      tokensUsed: 0
    };
  }

  // Check cache
  const cacheKey = context ? `${query.toLowerCase().trim()}|${context}` : query.toLowerCase().trim();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`Cache hit for query: ${query}`);
    return { answer: cached.result.answer, tokensUsed: 0 };
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const assistantId = await ensureSearchAssistant(vectorStoreId, openai);

  const searchPrompt = context
    ? `${query}\n\nContext: ${context}`
    : query;

  console.log(`Processing search query: ${query}`);

  const thread = await openai.beta.threads.create({
    messages: [
      {
        role: 'user',
        content: searchPrompt
      }
    ]
  });

  const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
    assistant_id: assistantId,
    temperature: 0,
    top_p: 0.1
  });

  let answerPayload: any = {
    signature: 'Not documented',
    parameters: 'Not documented',
    examples: 'Not documented',
    notes: 'Not documented',
    sources: []
  };

  const tokensUsed = run.usage?.total_tokens || 0;

  if (run.status === 'completed') {
    const messages = await openai.beta.threads.messages.list(thread.id);
    const assistantMessage = messages.data.find(m => m.role === 'assistant');
    if (assistantMessage && assistantMessage.content[0]?.type === 'text') {
      const raw = assistantMessage.content[0].text.value;
      try {
        // Strip markdown code blocks if present
        const jsonMatch = raw.match(/```json\n([\s\S]*?)\n```/) || raw.match(/```\n([\s\S]*?)\n```/) || [null, raw];
        const jsonStr = jsonMatch[1] || raw;
        answerPayload = JSON.parse(jsonStr);
      } catch (e: any) {
        console.warn('Failed to parse structured answer:', e.message);
        answerPayload = {
          signature: 'Unable to parse search result',
          parameters: raw,
          examples: '',
          notes: 'Returned raw search response; validate manually.',
          sources: []
        };
      }
    }
  } else {
    console.warn(`Run ended with status: ${run.status}`);
    answerPayload = {
      signature: 'Search failed',
      parameters: `Documentation search ended with status: ${run.status}`,
      examples: '',
      notes: 'Try refining the query or rerunning the search.',
      sources: []
    };
  }

  // Clean up thread
  try {
    await openai.beta.threads.del(thread.id);
  } catch (err) {
    console.warn('Failed to delete thread');
  }

  // Cache the result
  searchCache.set(cacheKey, {
    result: { answer: answerPayload },
    timestamp: Date.now()
  });

  return { answer: answerPayload, tokensUsed };
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'search-docs-plugin',
    timestamp: new Date().toISOString()
  });
});

// Main search endpoint
app.post('/search_docs', async (req, res) => {
  const body = req.body as SearchDocsRequest;
  const startTime = Date.now();

  try {
    const { query, context } = body.args || {};

    if (!query) {
      const result: PluginResult = {
        ok: false,
        tokensUsed: 0,
        artifacts: [],
        result: JSON.stringify({ error: 'query is required' }),
        error: 'query is required'
      };
      return res.json(result);
    }

    console.log(`[search_docs] session=${body.context?.sessionId} query="${query}"`);

    const { answer, tokensUsed } = await executeSearch(query, context);

    const result: PluginResult = {
      ok: true,
      tokensUsed,
      artifacts: [], // search_docs has no artifacts
      result: JSON.stringify({
        query,
        context,
        answer
      })
    };

    console.log(`[search_docs] completed in ${Date.now() - startTime}ms, tokens=${tokensUsed}`);
    res.json(result);

  } catch (error: any) {
    console.error('[search_docs] error:', error.message);
    const result: PluginResult = {
      ok: false,
      tokensUsed: 0,
      artifacts: [],
      result: JSON.stringify({ error: error.message }),
      error: error.message
    };
    res.json(result);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Search Docs Plugin running on port ${PORT}`);
  console.log(`Vector Store ID: ${process.env.OPENSCAD_VECTOR_STORE_ID || 'NOT SET'}`);
  console.log(`OpenAI API Key: ${process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET'}`);
});


