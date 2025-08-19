import { NextRequest, NextResponse } from 'next/server';
import { DatabaseService, ensureDatabaseInitialized } from '@/lib/database';
import { Pool } from 'pg';

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    
    // Create a new pool connection for debugging
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    const client = await pool.connect();
    
    try {
      // Get all cases with their workspace assignments
      const allCasesResult = await client.query(`
        SELECT 
          id,
          case_number,
          client_name,
          workspace_id,
          status,
          created_at,
          last_updated
        FROM cases
        ORDER BY case_number
      `);
      
      // Get all workspaces
      const workspacesResult = await client.query(`
        SELECT id, name FROM workspaces
      `);
      
      // Get David workspace specifically
      const davidWorkspaceResult = await client.query(`
        SELECT * FROM workspaces WHERE name ILIKE '%david%'
      `);
      
      // Get cases assigned to David workspace
      const davidWorkspaceId = davidWorkspaceResult.rows[0]?.id;
      let davidCases = [];
      if (davidWorkspaceId) {
        const davidCasesResult = await client.query(`
          SELECT 
            id,
            case_number,
            client_name,
            workspace_id
          FROM cases
          WHERE workspace_id = $1
          ORDER BY case_number
        `, [davidWorkspaceId]);
        davidCases = davidCasesResult.rows;
      }
      
      // Get user michaelalanwilson@outlook.com
      const userResult = await client.query(`
        SELECT 
          id,
          email,
          workspace_id,
          role
        FROM user_accounts
        WHERE email = 'michaelalanwilson@outlook.com'
      `);
      
      // Get what cases the user would see with current query
      const userId = userResult.rows[0]?.id;
      let userCases = [];
      if (userId) {
        const userCasesResult = await client.query(`
          SELECT c.* FROM cases c 
          JOIN user_accounts u ON u.id = $1
          WHERE (u.workspace_id IS NULL OR c.workspace_id = u.workspace_id)
          ORDER BY c.last_updated DESC
        `, [userId]);
        userCases = userCasesResult.rows.map(c => ({
          id: c.id,
          case_number: c.case_number,
          client_name: c.client_name,
          workspace_id: c.workspace_id
        }));
      }
      
      return NextResponse.json({
        summary: {
          totalCases: allCasesResult.rows.length,
          totalWorkspaces: workspacesResult.rows.length,
          davidWorkspaceId,
          davidCasesCount: davidCases.length,
          userEmail: userResult.rows[0]?.email,
          userWorkspaceId: userResult.rows[0]?.workspace_id,
          userRole: userResult.rows[0]?.role,
          casesUserWouldSee: userCases.length
        },
        allCases: allCasesResult.rows,
        workspaces: workspacesResult.rows,
        davidWorkspace: davidWorkspaceResult.rows[0],
        davidCases,
        user: userResult.rows[0],
        userCases
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Debug error:', error);
    return NextResponse.json({ 
      error: 'Failed to debug workspace cases', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}