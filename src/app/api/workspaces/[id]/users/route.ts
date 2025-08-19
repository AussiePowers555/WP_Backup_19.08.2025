import { NextRequest, NextResponse } from 'next/server';
import { DatabaseService, ensureDatabaseInitialized, db } from '@/lib/database';
import { authenticateRequest } from '@/lib/server-auth';
import { v4 as uuidv4 } from 'uuid';
import { hashPassword, generateTempPassword } from '@/lib/passwords';

// GET /api/workspaces/[id]/users - Get all users in a workspace
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDatabaseInitialized();
    const authResult = await authenticateRequest(request);
    if (!authResult.success || !authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: workspaceId } = await context.params;

    // Get all users in the workspace (exclude deleted users)
    if (!db) {
      throw new Error('Database not initialized');
    }
    const result = await db.query(`
      SELECT 
        wu.id,
        wu.user_id,
        wu.workspace_id,
        wu.role,
        wu.display_name,
        wu.is_active,
        wu.joined_at,
        COALESCE(wu.display_name, u.email) as name,
        u.email,
        u.status as user_status,
        u.last_login
      FROM workspace_users wu
      JOIN user_accounts u ON wu.user_id = u.id
      WHERE wu.workspace_id = $1 AND wu.is_active = true AND u.status != 'deleted'
      ORDER BY wu.joined_at DESC
    `, [workspaceId]);
    
    return NextResponse.json({ 
      users: result.rows,
      currentUserRole: authResult.user.role
    });
  } catch (error) {
    console.error('Error fetching workspace users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workspace users' },
      { status: 500 }
    );
  }
}

// POST /api/workspaces/[id]/users - Add a user to a workspace
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDatabaseInitialized();
    const authResult = await authenticateRequest(request);
    if (!authResult.success || !authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: workspaceId } = await context.params;
    const body = await request.json();

    // Check if user has admin access
    if (authResult.user.role !== 'admin' && authResult.user.role !== 'developer') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { email, display_name, role, password, send_email = false } = body;

    // Validate role
    if (!['admin', 'developer', 'client'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Validate password if provided
    if (password && password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    // Start transaction
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Check if user already exists
      let userResult = await client.query(
        'SELECT id, email FROM user_accounts WHERE email = $1',
        [email]
      );

      let userId;
      let tempPassword = '';
      let isNewUser = false;

      if (userResult.rows.length === 0) {
        // Create new user
        userId = uuidv4();
        // Use provided password or generate one
        tempPassword = password || generateTempPassword();
        const hashedPassword = hashPassword(tempPassword);

        await client.query(`
          INSERT INTO user_accounts (id, email, password_hash, role, status, workspace_id)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [userId, email, hashedPassword, 'client', 'active', workspaceId]);
        
        isNewUser = true;
      } else {
        userId = userResult.rows[0].id;
      }

      // Check if user is already in workspace
      const existingMembership = await client.query(
        'SELECT id FROM workspace_users WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
      );

      if (existingMembership.rows.length > 0) {
        // Reactivate if inactive
        await client.query(`
          UPDATE workspace_users 
          SET is_active = true, role = $3, display_name = $4, joined_at = NOW()
          WHERE workspace_id = $1 AND user_id = $2
        `, [workspaceId, userId, role, display_name]);
      } else {
        // Add user to workspace
        await client.query(`
          INSERT INTO workspace_users (id, workspace_id, user_id, role, display_name, invited_by, invited_at, joined_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        `, [uuidv4(), workspaceId, userId, role, display_name, authResult.user.id]);
      }

      await client.query('COMMIT');

      // Track credential distribution if new user
      if (isNewUser) {
        await DatabaseService.createCredentialDistribution({
          user_id: userId,
          workspace_id: workspaceId,
          recipient_email: email,
          recipient_name: display_name,
          distribution_method: 'workspace_invitation',
          credentials_data: {
            email,
            tempPassword,
            workspace_id: workspaceId,
            role
          },
          distributed_by: authResult.user.id
        });
      }

      return NextResponse.json({
        success: true,
        user: {
          id: userId,
          email,
          name: display_name
        },
        credentials: isNewUser ? {
          email,
          password: tempPassword,
          loginUrl: process.env.NEXT_PUBLIC_BASE_URL || 'https://app.whitepointer.com'
        } : null
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error adding user to workspace:', error);
    return NextResponse.json(
      { error: 'Failed to add user to workspace' },
      { status: 500 }
    );
  }
}

// PUT /api/workspaces/[id]/users - Update a user's role in a workspace
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDatabaseInitialized();
    const authResult = await authenticateRequest(request);
    if (!authResult.success || !authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: workspaceId } = await context.params;
    const body = await request.json();

    // Check if user has admin access
    if (authResult.user.role !== 'admin' && authResult.user.role !== 'developer') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { user_id, role, display_name, is_active } = body;

    // Validate role if provided
    if (role && !['admin', 'developer', 'client'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Prevent user from modifying their own role
    if (user_id === authResult.user.id && role && role !== authResult.user.role) {
      return NextResponse.json({ error: 'Cannot modify your own role' }, { status: 400 });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 2;

    if (role !== undefined) {
      updates.push(`role = $${paramCount++}`);
      values.push(role);
    }
    if (display_name !== undefined) {
      updates.push(`display_name = $${paramCount++}`);
      values.push(display_name);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    // Update user in workspace
    await db.query(`
      UPDATE workspace_users 
      SET ${updates.join(', ')}
      WHERE workspace_id = $1 AND user_id = $2
    `, [workspaceId, user_id, ...values]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating workspace user:', error);
    return NextResponse.json(
      { error: 'Failed to update workspace user' },
      { status: 500 }
    );
  }
}

// DELETE /api/workspaces/[id]/users - Remove a user from a workspace
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDatabaseInitialized();
    const authResult = await authenticateRequest(request);
    if (!authResult.success || !authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: workspaceId } = await context.params;
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    // Check if user has admin access
    if (authResult.user.role !== 'admin' && authResult.user.role !== 'developer') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Prevent user from removing themselves
    if (userId === authResult.user.id) {
      return NextResponse.json({ error: 'Cannot remove yourself from workspace' }, { status: 400 });
    }

    // Remove user from workspace (soft delete)
    await db.query(`
      UPDATE workspace_users 
      SET is_active = false, removed_at = NOW()
      WHERE workspace_id = $1 AND user_id = $2
    `, [workspaceId, userId]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing user from workspace:', error);
    return NextResponse.json(
      { error: 'Failed to remove user from workspace' },
      { status: 500 }
    );
  }
}