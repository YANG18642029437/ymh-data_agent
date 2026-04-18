# SQL 诊断模板

常用诊断查询，按场景分类。所有查询均适用于 `exec_sql(sql, env='develop'|'product')`。

## 目录

1. [Schema 探索](#schema-探索)
2. [数据完整性检查](#数据完整性检查)
3. [状态异常诊断](#状态异常诊断)
4. [时序分析](#时序分析)
5. [性能诊断](#性能诊断)

---

## Schema 探索

```sql
-- 列出所有表（PostgreSQL）
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 查看表结构
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = '<table_name>'
ORDER BY ordinal_position;

-- 查看表的索引
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = '<table_name>';

-- 查看表的外键约束
SELECT
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = '<table_name>';
```

---

## 数据完整性检查

```sql
-- 统计总量与最近更新时间
SELECT COUNT(*) AS total, MAX(created_at) AS latest_created
FROM <table>;

-- 查找空值异常
SELECT COUNT(*) AS null_count
FROM <table>
WHERE <expected_non_null_column> IS NULL;

-- 查找孤儿记录（子表无对应父记录）
SELECT a.id, a.parent_id
FROM <child_table> a
LEFT JOIN <parent_table> b ON a.parent_id = b.id
WHERE b.id IS NULL
LIMIT 50;

-- 查找重复记录
SELECT <unique_field>, COUNT(*) AS cnt
FROM <table>
GROUP BY <unique_field>
HAVING COUNT(*) > 1
ORDER BY cnt DESC
LIMIT 20;
```

---

## 状态异常诊断

```sql
-- 状态值分布
SELECT status, COUNT(*) AS cnt
FROM <table>
GROUP BY status
ORDER BY cnt DESC;

-- 找出不在预期状态列表中的记录
SELECT id, status, created_at, updated_at
FROM <table>
WHERE status NOT IN ('active', 'completed', 'pending')
ORDER BY updated_at DESC
LIMIT 30;

-- 长时间处于中间状态（如"处理中"超过1小时）
SELECT id, status, updated_at,
       NOW() - updated_at AS stuck_duration
FROM <table>
WHERE status = 'processing'
  AND updated_at < NOW() - INTERVAL '1 hour'
ORDER BY updated_at ASC
LIMIT 20;

-- 某实体的完整状态流转历史
SELECT id, status, created_at, updated_at
FROM <table>
WHERE id = <target_id>
ORDER BY updated_at;
```

---

## 时序分析

```sql
-- 按小时统计最近24小时的写入量
SELECT
    DATE_TRUNC('hour', created_at) AS hour,
    COUNT(*) AS cnt
FROM <table>
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY 1
ORDER BY 1;

-- 对比今日与昨日同时段数据量
SELECT
    CASE
        WHEN created_at > NOW() - INTERVAL '24 hours' THEN 'today'
        ELSE 'yesterday'
    END AS period,
    COUNT(*) AS cnt
FROM <table>
WHERE created_at > NOW() - INTERVAL '48 hours'
GROUP BY 1;

-- 最近N条记录（快速检查最新数据）
SELECT *
FROM <table>
ORDER BY created_at DESC
LIMIT 20;

-- 特定时间段内的变化
SELECT COUNT(*) AS cnt
FROM <table>
WHERE updated_at BETWEEN '<start_time>' AND '<end_time>';
```

---

## 性能诊断

```sql
-- 查询表的行数估算（大表快速估算）
SELECT relname AS table_name,
       n_live_tup AS estimated_rows
FROM pg_stat_user_tables
WHERE relname = '<table_name>';

-- 查看缺少索引的高频过滤列（需要 pg_stat_statements 扩展）
-- 如无扩展，手动检查 WHERE 子句中常用列是否有索引

-- 查找大表中无索引的外键列
SELECT
    kcu.column_name,
    tc.table_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = '<table_name>'
  AND kcu.column_name NOT IN (
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = '<table_name>'::regclass
  );
```
