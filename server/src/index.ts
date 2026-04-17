import express from "express";
import cors from "cors";
import { getSupabaseClient } from "./storage/database/supabase-client";
import { KnowledgeClient, Config, LLMClient } from 'coze-coding-dev-sdk';
import type { KnowledgeDocument } from 'coze-coding-dev-sdk';
import { DataSourceType } from 'coze-coding-dev-sdk';

const app = express();
const port = process.env.PORT || 9091;

// Initialize Supabase client
const supabase = getSupabaseClient();

// Initialize Knowledge client for vector storage
const knowledgeConfig = new Config();
const knowledgeClient = new KnowledgeClient(knowledgeConfig);

const KNOWLEDGE_TABLE = "personal_records";

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health check
app.get('/api/v1/health', (req, res) => {
  console.log('Health check success');
  res.status(200).json({ status: 'ok' });
});

// GET /api/v1/records - Get all records
app.get('/api/v1/records', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('records')
      .select('id, title, content, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) throw new Error(`查询失败: ${error.message}`);

    const records = (data || []).map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    res.json({ code: 0, data: records });
  } catch (err: any) {
    console.error('Error fetching records:', err);
    res.status(500).json({ code: 1, message: err.message });
  }
});

// POST /api/v1/records - Create new record (also store in vector database)
app.post('/api/v1/records', async (req, res) => {
  try {
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ code: 1, message: '标题和内容不能为空' });
    }

    // Insert into Supabase
    const { data: insertData, error: insertError } = await supabase
      .from('records')
      .insert({ title, content })
      .select('id, title, content, created_at, updated_at')
      .single();

    if (insertError) throw new Error(`插入失败: ${insertError.message}`);

    const record = {
      id: insertData.id,
      title: insertData.title,
      content: insertData.content,
      createdAt: insertData.created_at,
      updatedAt: insertData.updated_at,
    };

    // Store in vector database for semantic search
    try {
      const docs: KnowledgeDocument[] = [
        {
          source: DataSourceType.TEXT,
          raw_data: `标题: ${title}\n\n内容: ${content}`,
        }
      ];

      await knowledgeClient.addDocuments(docs, KNOWLEDGE_TABLE);
    } catch (vecErr) {
      console.error('Warning: Failed to store in vector DB:', vecErr);
      // Continue even if vector storage fails
    }

    res.json({ code: 0, data: record });
  } catch (err: any) {
    console.error('Error creating record:', err);
    res.status(500).json({ code: 1, message: err.message });
  }
});

// PUT /api/v1/records/:id - Update record
app.put('/api/v1/records/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ code: 1, message: '标题和内容不能为空' });
    }

    const { data, error } = await supabase
      .from('records')
      .update({ title, content, updated_at: new Date().toISOString() })
      .eq('id', parseInt(id))
      .select('id, title, content, created_at, updated_at')
      .single();

    if (error) throw new Error(`更新失败: ${error.message}`);
    if (!data) return res.status(404).json({ code: 1, message: '记录不存在' });

    res.json({
      code: 0,
      data: {
        id: data.id,
        title: data.title,
        content: data.content,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      }
    });
  } catch (err: any) {
    console.error('Error updating record:', err);
    res.status(500).json({ code: 1, message: err.message });
  }
});

// DELETE /api/v1/records/:id - Delete record
app.delete('/api/v1/records/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('records')
      .delete()
      .eq('id', parseInt(id));

    if (error) throw new Error(`删除失败: ${error.message}`);

    res.json({ code: 0, message: '删除成功' });
  } catch (err: any) {
    console.error('Error deleting record:', err);
    res.status(500).json({ code: 1, message: err.message });
  }
});

// GET /api/v1/records/search - Semantic search records
app.get('/api/v1/records/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ code: 1, message: '搜索关键词不能为空' });
    }

    // Try semantic search first, fallback to keyword search
    let records: any[] = [];
    let source = 'keyword';

    try {
      const searchResponse = await knowledgeClient.search(q as string, [KNOWLEDGE_TABLE], 10, 0.3);

      if (searchResponse.code === 0 && searchResponse.chunks && searchResponse.chunks.length > 0) {
        // Extract titles from search results and search in Supabase
        const titles = searchResponse.chunks.map(chunk => {
          const match = chunk.content.match(/标题:\s*(.+?)\n/);
          return match ? match[1].trim() : null;
        }).filter(Boolean);

        if (titles.length > 0) {
          const { data, error } = await supabase
            .from('records')
            .select('id, title, content, created_at, updated_at')
            .in('title', titles)
            .order('created_at', { ascending: false });

          if (!error && data && data.length > 0) {
            records = data;
            source = 'semantic';
          }
        }
      }
    } catch (vecError) {
      console.error('Vector search error, falling back to keyword:', vecError);
    }

    // Fallback to keyword search if semantic search returned no results
    if (records.length === 0) {
      const { data, error } = await supabase
        .from('records')
        .select('id, title, content, created_at, updated_at')
        .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw new Error(`搜索失败: ${error.message}`);
      records = data || [];
    }

    const result = records.map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    res.json({ code: 0, data: result, source });
  } catch (err: any) {
    console.error('Error searching records:', err);
    res.status(500).json({ code: 1, message: err.message });
  }
});

// POST /api/v1/chat - Streaming chat with knowledge base
app.post('/api/v1/chat', async (req, res) => {
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // 1. Search knowledge base for relevant information
    let contextText = '';
    
    try {
      const searchResponse = await knowledgeClient.search(query, [KNOWLEDGE_TABLE], 5, 0.3);
      
      if (searchResponse.code === 0 && searchResponse.chunks && searchResponse.chunks.length > 0) {
        contextText = searchResponse.chunks
          .map(chunk => chunk.content)
          .join('\n\n');
      }
    } catch (searchError) {
      console.error('Knowledge search error:', searchError);
      // Continue without knowledge context
    }

    // 2. Build system prompt
    const systemPrompt = `你是用户的个人数据助手。你的职责是根据用户提供的记录数据来回答问题。

当用户提供的问题与记录数据相关时，你应该：
1. 基于搜索到的记录内容来回答问题
2. 如果没有找到相关信息，诚实地告诉用户"我在你的记录中没有找到相关信息"
3. 回答要简洁、有条理

如果用户的问题与记录数据无关，你可以友好地提醒用户你只能回答与他的个人记录相关的问题。

记录数据：
${contextText || '（暂无相关记录）'}`;

    // 3. Initialize LLM client and stream response
    const llmConfig = new Config();
    const llmClient = new LLMClient(llmConfig);

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: query },
    ];

    // Stream response
    const stream = llmClient.stream(messages, {
      temperature: 0.7,
    });

    let fullContent = '';
    for await (const chunk of stream) {
      if (chunk.content) {
        const text = chunk.content.toString();
        fullContent += text;
        // Must use SSE format: "data: xxx\n\n" for EventSource client
        res.write(`data: ${text}\n\n`);
      }
    }

    // Send completion marker in SSE format
    res.write('data: [DONE]\n\n');
    res.end();
    console.log('Chat completed, sent', fullContent.length, 'characters');

  } catch (err: any) {
    console.error('Chat error:', err);
    res.write('data: 抱歉，发生了错误，请稍后重试。\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}/`);
});
