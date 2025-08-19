import { NextRequest, NextResponse } from 'next/server';
import { DatabaseService, ensureDatabaseInitialized } from '@/lib/database';
import { getUserFromRequest } from '@/lib/server-auth';

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get workspace ID from user or query params
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId') || user.workspaceId;

    if (!workspaceId) {
      return NextResponse.json({ 
        error: 'No workspace specified',
        user: { email: user.email, workspaceId: user.workspaceId }
      }, { status: 400 });
    }

    // Get all cases for the workspace
    const cases = await DatabaseService.getCasesForWorkspace(workspaceId);
    const caseNumbers = cases.map(c => c.caseNumber);
    
    // Get interactions for those cases
    const interactions = await DatabaseService.getInteractionsForCases(caseNumbers);
    
    return NextResponse.json({ 
      success: true,
      workspaceId,
      totalCases: cases.length,
      caseNumbers,
      totalInteractions: interactions.length,
      interactions
    });
  } catch (error) {
    console.error('Error fetching workspace interactions:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch workspace interactions', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}