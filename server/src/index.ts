import express from "express";
import cors from "cors";
import { getSupabaseClient } from "./storage/database/supabase-client";
import { KnowledgeClient, Config } from 'coze-coding-dev-sdk';
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

    // Search in vector database
    const searchResponse = await knowledgeClient.search(q as string, [KNOWLEDGE_TABLE], 10, 0.3);

    if (searchResponse.code !== 0) {
      console.error('Vector search failed:', searchResponse.msg);
      // Fallback to keyword search in Supabase
      const { data, error } = await supabase
        .from('records')
        .select('id, title, content, created_at, updated_at')
        .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw new Error(`搜索失败: ${error.message}`);

      const records = (data || []).map(r => ({
        id: r.id,
        title: r.title,
        content: r.content,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

      return res.json({ code: 0, data: records, source: 'keyword' });
    }

    // Extract search results from chunks
    const searchResults = searchResponse.chunks || [];
    
    if (searchResults.length === 0) {
      return res.json({ code: 0, data: [], source: 'semantic' });
    }

    // Extract titles from search results and search in Supabase
    const titles = searchResults.map(chunk => {
      const match = chunk.content.match(/标题:\s*(.+?)\n/);
      return match ? match[1].trim() : null;
    }).filter(Boolean);

    if (titles.length === 0) {
      return res.json({ code: 0, data: [], source: 'semantic' });
    }

    // Fetch full records from Supabase
    const { data, error } = await supabase
      .from('records')
      .select('id, title, content, created_at, updated_at')
      .in('title', titles)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`获取记录失败: ${error.message}`);

    const records = (data || []).map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    res.json({ code: 0, data: records, source: 'semantic' });
  } catch (err: any) {
    console.error('Error searching records:', err);
    res.status(500).json({ code: 1, message: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}/`);
});
