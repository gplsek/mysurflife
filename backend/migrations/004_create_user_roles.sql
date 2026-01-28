-- Migration 004: Create user_roles table for admin access control
-- Run this in Supabase SQL Editor

-- Create user_roles table
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    is_admin BOOLEAN DEFAULT false,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_admin ON user_roles(is_admin) WHERE is_admin = true;

-- Enable Row Level Security
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own roles
DROP POLICY IF EXISTS "Users can view own roles" ON user_roles;
CREATE POLICY "Users can view own roles" ON user_roles
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Service role can manage all roles (for admin bootstrap)
DROP POLICY IF EXISTS "Service role can manage roles" ON user_roles;
CREATE POLICY "Service role can manage roles" ON user_roles
    FOR ALL
    USING (auth.role() = 'service_role');

-- Grant access to authenticated users
GRANT SELECT ON user_roles TO authenticated;
GRANT ALL ON user_roles TO service_role;

-- Verify table creation
SELECT
    'user_roles table created successfully' AS status,
    COUNT(*) AS row_count
FROM user_roles;
