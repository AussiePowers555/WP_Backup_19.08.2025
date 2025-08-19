import { NextRequest, NextResponse } from 'next/server';
import { DatabaseService, ensureDatabaseInitialized } from '@/lib/database';
import { getUserFromRequest } from '@/lib/server-auth';

export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspaceId } = await request.json();
    
    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace ID required' }, { status: 400 });
    }

    // Get all cases for the workspace
    const cases = await DatabaseService.getCasesForWorkspace(workspaceId);
    
    // Get all interactions for those cases
    const caseNumbers = cases.map(c => c.caseNumber);
    const interactions = await DatabaseService.getInteractionsForCases(caseNumbers);
    
    return NextResponse.json({ 
      success: true, 
      cases: cases.length,
      interactions: interactions.length,
      data: {
        cases,
        interactions
      }
    });
  } catch (error) {
    console.error('Error syncing workspace cases:', error);
    return NextResponse.json({ 
      error: 'Failed to sync workspace cases', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user.workspaceId) {
      return NextResponse.json({ error: 'User not assigned to workspace' }, { status: 400 });
    }

    // Get all cases for the user's workspace
    const cases = await DatabaseService.getCasesForWorkspace(user.workspaceId);
    
    // Get all interactions for those cases  
    const caseNumbers = cases.map(c => c.caseNumber);
    const interactions = await DatabaseService.getInteractionsForCases(caseNumbers);
    
    return NextResponse.json({ 
      workspaceId: user.workspaceId,
      cases: cases.length,
      interactions: interactions.length,
      data: {
        cases,
        interactions
      }
    });
  } catch (error) {
    console.error('Error getting workspace cases:', error);
    return NextResponse.json({ 
      error: 'Failed to get workspace cases', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}