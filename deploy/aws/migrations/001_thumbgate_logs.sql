-- Core Production Database Migration Script for ThumbGate Cloud Sink
-- Targets: PostgreSQL 15+

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Main Telemetry Records Table
CREATE TABLE IF NOT EXISTS thumbgate_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    developer_id VARCHAR(64) NOT NULL,
    agent_framework VARCHAR(100) NOT NULL,
    tool_proposed TEXT NOT NULL,
    loop_depth INT NOT NULL DEFAULT 1,
    tokens_input INT NOT NULL DEFAULT 0,
    tokens_saved INT NOT NULL DEFAULT 0,
    decision VARCHAR(10) NOT NULL,
    rule_triggered VARCHAR(100),
    latency_ms NUMERIC(6, 3) NOT NULL,
    explicit_rating VARCHAR(20) DEFAULT 'unrated',
    is_dpo_pair BOOLEAN NOT NULL DEFAULT FALSE,
    action_context JSONB NOT NULL
);

-- 2. Performance-Critical Database Indices
-- High-speed lookup for billing, audit dashboards, and background fine-tuning selection

-- Index for real-time dashboard tracking client execution latency and volume spikes
CREATE INDEX IF NOT EXISTS idx_logs_developer_decision_time
ON thumbgate_logs (developer_id, decision, created_at DESC);

-- Index for instant metrics math (Saves, Loop depths, Token costs) over sliding windows
CREATE INDEX IF NOT EXISTS idx_logs_metrics_aggregation
ON thumbgate_logs (created_at DESC)
INCLUDE (tokens_input, tokens_saved, loop_depth, latency_ms);

-- Partial index for machine learning data pipelines pulling target DPO preferences instantly
CREATE INDEX IF NOT EXISTS idx_logs_dpo_extract
ON thumbgate_logs (created_at DESC)
WHERE is_dpo_pair IS TRUE AND explicit_rating = 'thumbs_down';

-- GIN index on context JSONB to allow unstructured searches across arbitrary agent tool payloads
CREATE INDEX IF NOT EXISTS idx_logs_context_gin
ON thumbgate_logs USING gin (action_context);
