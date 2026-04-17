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
    let vectorDocId: string | null = null;
    try {
      const docs: KnowledgeDocument[] = [
        {
          source: DataSourceType.TEXT,
          raw_data: `ID:${insertData.id}|标题: ${title}\n\n内容: ${content}`,
        }
      ];

      const vecResult = await knowledgeClient.addDocuments(docs, KNOWLEDGE_TABLE);
      if (vecResult.code === 0 && vecResult.doc_ids && vecResult.doc_ids.length > 0) {
        vectorDocId = vecResult.doc_ids[0];
      }
    } catch (vecErr) {
      console.error('Warning: Failed to store in vector DB:', vecErr);
      // Continue even if vector storage fails
    }

    // Update vector_doc_id in Supabase
    if (vectorDocId) {
      await supabase
        .from('records')
        .update({ vector_doc_id: vectorDocId })
        .eq('id', insertData.id);
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

    // Get the old record to retrieve vector_doc_id
    const { data: oldRecord, error: fetchError } = await supabase
      .from('records')
      .select('id, title, content, created_at, updated_at, vector_doc_id')
      .eq('id', parseInt(id))
      .single();

    if (fetchError) throw new Error(`查询失败: ${fetchError.message}`);
    if (!oldRecord) return res.status(404).json({ code: 1, message: '记录不存在' });

    const oldVectorDocId = oldRecord.vector_doc_id;

    // Update in Supabase
    const { data, error } = await supabase
      .from('records')
      .update({ title, content, updated_at: new Date().toISOString(), vector_doc_id: null })
      .eq('id', parseInt(id))
      .select('id, title, content, created_at, updated_at')
      .single();

    if (error) throw new Error(`更新失败: ${error.message}`);

    // Re-index in vector database (delete old + add new)
    let newVectorDocId: string | null = null;
    try {
      const docs: KnowledgeDocument[] = [
        {
          source: DataSourceType.TEXT,
          raw_data: `ID:${data.id}|标题: ${title}\n\n内容: ${content}`,
        }
      ];

      const vecResult = await knowledgeClient.addDocuments(docs, KNOWLEDGE_TABLE);
      if (vecResult.code === 0 && vecResult.doc_ids && vecResult.doc_ids.length > 0) {
        newVectorDocId = vecResult.doc_ids[0];
      }
    } catch (vecErr) {
      console.error('Warning: Failed to re-index in vector DB:', vecErr);
      // Continue even if vector indexing fails
    }

    // Update with new vector_doc_id
    if (newVectorDocId) {
      await supabase
        .from('records')
        .update({ vector_doc_id: newVectorDocId })
        .eq('id', parseInt(id));
    }

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

    // First invalidate the vector_doc_id (orphan the vector doc)
    await supabase
      .from('records')
      .update({ vector_doc_id: null })
      .eq('id', parseInt(id));

    // Then delete from Supabase
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
        // Extract record IDs and titles from search results
        const results: { id: number | null; title: string | null; docId: string | null }[] = searchResponse.chunks.map(chunk => {
          // Match format: "ID:123|标题: xxx"
          const idMatch = chunk.content.match(/ID:(\d+)/);
          const titleMatch = chunk.content.match(/标题:\s*(.+?)\n/);
          return {
            id: idMatch ? parseInt(idMatch[1]) : null,
            title: titleMatch ? titleMatch[1].trim() : null,
            docId: chunk.doc_id || null,
          };
        }).filter(r => r.id !== null || r.title !== null);

        if (results.length > 0) {
          // Validate against Supabase - check both id and vector_doc_id match
          const validIds = results
            .filter(r => r.id !== null)
            .map(r => r.id as number);

          if (validIds.length > 0) {
            const { data, error } = await supabase
              .from('records')
              .select('id, title, content, created_at, updated_at, vector_doc_id')
              .in('id', validIds)
              .order('created_at', { ascending: false });

            if (!error && data && data.length > 0) {
              // Filter: record must exist AND vector_doc_id must match
              const validRecords = data.filter(record => {
                const searchResult = results.find(r => r.id === record.id);
                // If search returned a doc_id, verify it matches
                if (searchResult && searchResult.docId) {
                  return record.vector_doc_id === searchResult.docId;
                }
                return true; // If no doc_id in search result, include anyway
              });

              if (validRecords.length > 0) {
                records = validRecords;
                source = 'semantic';
              }
            }
          }

          // If semantic search failed validation, try title match
          if (records.length === 0) {
            const validTitles = results
              .filter(r => r.title !== null)
              .map(r => r.title as string);

            if (validTitles.length > 0) {
              const { data, error } = await supabase
                .from('records')
                .select('id, title, content, created_at, updated_at')
                .in('title', validTitles)
                .order('created_at', { ascending: false });

              if (!error && data && data.length > 0) {
                records = data;
                source = 'semantic';
              }
            }
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
    // 1. Search knowledge base for relevant information (with validation)
    let contextText = '';

    try {
      const searchResponse = await knowledgeClient.search(query, [KNOWLEDGE_TABLE], 5, 0.3);

      if (searchResponse.code === 0 && searchResponse.chunks && searchResponse.chunks.length > 0) {
        // Extract record IDs from search results
        const results: { id: number | null; title: string | null; docId: string | null; content: string }[] = searchResponse.chunks.map(chunk => {
          // Match format: "ID:123|标题: xxx"
          const idMatch = chunk.content.match(/ID:(\d+)/);
          const titleMatch = chunk.content.match(/标题:\s*(.+?)\n/);
          return {
            id: idMatch ? parseInt(idMatch[1]) : null,
            title: titleMatch ? titleMatch[1].trim() : null,
            docId: chunk.doc_id || null,
            content: chunk.content,
          };
        });

        // Validate against Supabase - only use records with matching vector_doc_id
        const validIds = results
          .filter(r => r.id !== null)
          .map(r => r.id as number);

        if (validIds.length > 0) {
          const { data, error } = await supabase
            .from('records')
            .select('id, title, content, vector_doc_id')
            .in('id', validIds);

          if (!error && data && data.length > 0) {
            // Filter: record must exist AND vector_doc_id must match
            const validContents = data
              .filter(record => {
                const searchResult = results.find(r => r.id === record.id);
                if (searchResult && searchResult.docId) {
                  return record.vector_doc_id === searchResult.docId;
                }
                return true;
              })
              .map(record => `标题: ${record.title}\n\n内容: ${record.content}`);

            if (validContents.length > 0) {
              contextText = validContents.join('\n\n---\n\n');
            }
          }
        }
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
