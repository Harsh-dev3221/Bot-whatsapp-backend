-- Add RLS Policies for Workflows, Inquiries, and Knowledge Base
-- Run in Supabase SQL Editor

-- 1) Enable RLS on all workflow-related tables
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2) WORKFLOWS TABLE POLICIES
-- ============================================================================

-- Allow bot owners to view their workflows
CREATE POLICY "Users can view their own bot workflows"
  ON workflows
  FOR SELECT
  USING (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- Allow bot owners to create workflows
CREATE POLICY "Users can create workflows for their bots"
  ON workflows
  FOR INSERT
  WITH CHECK (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- Allow bot owners to update their workflows
CREATE POLICY "Users can update their own bot workflows"
  ON workflows
  FOR UPDATE
  USING (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  )
  WITH CHECK (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- Allow bot owners to delete their workflows
CREATE POLICY "Users can delete their own bot workflows"
  ON workflows
  FOR DELETE
  USING (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- ============================================================================
-- 3) WORKFLOW_CONVERSATIONS TABLE POLICIES
-- ============================================================================

-- Allow bot owners to view workflow conversations
CREATE POLICY "Users can view their bot workflow conversations"
  ON workflow_conversations
  FOR SELECT
  USING (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- Allow system to create workflow conversations (for bot processing)
-- Note: This needs to be called from a service role context or backend
CREATE POLICY "System can create workflow conversations"
  ON workflow_conversations
  FOR INSERT
  WITH CHECK (true); -- Will be restricted by backend logic

-- Allow bot owners to update workflow conversations
CREATE POLICY "Users can update their bot workflow conversations"
  ON workflow_conversations
  FOR UPDATE
  USING (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  )
  WITH CHECK (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- Allow bot owners to delete workflow conversations
CREATE POLICY "Users can delete their bot workflow conversations"
  ON workflow_conversations
  FOR DELETE
  USING (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- ============================================================================
-- 4) INQUIRIES TABLE POLICIES
-- ============================================================================

-- Allow bot owners to view their inquiries
CREATE POLICY "Users can view their bot inquiries"
  ON inquiries
  FOR SELECT
  USING (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- Allow system to create inquiries (for bot processing)
CREATE POLICY "System can create inquiries"
  ON inquiries
  FOR INSERT
  WITH CHECK (true); -- Will be restricted by backend logic

-- Allow bot owners to update their inquiries
CREATE POLICY "Users can update their bot inquiries"
  ON inquiries
  FOR UPDATE
  USING (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  )
  WITH CHECK (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- Allow bot owners to delete their inquiries
CREATE POLICY "Users can delete their bot inquiries"
  ON inquiries
  FOR DELETE
  USING (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- ============================================================================
-- 5) KNOWLEDGE_BASE TABLE POLICIES
-- ============================================================================

-- Allow bot owners to view their knowledge base
CREATE POLICY "Users can view their bot knowledge base"
  ON knowledge_base
  FOR SELECT
  USING (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- Allow bot owners to create knowledge base entries
CREATE POLICY "Users can create knowledge base for their bots"
  ON knowledge_base
  FOR INSERT
  WITH CHECK (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- Allow bot owners to update their knowledge base
CREATE POLICY "Users can update their bot knowledge base"
  ON knowledge_base
  FOR UPDATE
  USING (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  )
  WITH CHECK (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- Allow bot owners to delete their knowledge base entries
CREATE POLICY "Users can delete their bot knowledge base"
  ON knowledge_base
  FOR DELETE
  USING (
    bot_id IN (
      SELECT id FROM bots 
      WHERE business_id IN (
        SELECT business_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- ============================================================================
-- 6) SERVICE ROLE BYPASS (for backend operations)
-- ============================================================================
-- The backend should use service_role key for automated operations
-- These policies ensure the service role can bypass RLS when needed

-- Note: When your backend needs to create workflow_conversations or inquiries
-- automatically (from bot interactions), use the service role client, not anon key

COMMENT ON TABLE workflows IS 'RLS enabled: Only bot owners can manage their workflows';
COMMENT ON TABLE workflow_conversations IS 'RLS enabled: Bot owners can view/manage, system can create via service role';
COMMENT ON TABLE inquiries IS 'RLS enabled: Bot owners can view/manage, system can create via service role';
COMMENT ON TABLE knowledge_base IS 'RLS enabled: Only bot owners can manage their knowledge base';
