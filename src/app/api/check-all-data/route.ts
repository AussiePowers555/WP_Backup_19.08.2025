import { NextRequest, NextResponse } from 'next/server';
import { DatabaseService, ensureDatabaseInitialized } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    
    // Get all cases
    const allCases = await DatabaseService.getAllCases();
    
    // Get all workspaces
    const allWorkspaces = await DatabaseService.getAllWorkspaces();
    
    // Find David workspace
    const davidWorkspace = allWorkspaces.find((w: any) => 
      w.name?.toLowerCase().includes('david') || 
      w.contact?.name?.toLowerCase().includes('david')
    );
    
    // Filter cases by David workspace
    const davidCases = allCases.filter((c: any) => 
      c.workspaceId === davidWorkspace?.id
    );
    
    // Get unique case numbers from all cases
    const allCaseNumbers = [...new Set(allCases.map((c: any) => c.caseNumber))];
    const davidCaseNumbers = [...new Set(davidCases.map((c: any) => c.caseNumber))];
    
    // Get interactions for all cases
    const allInteractions = await DatabaseService.getInteractionsForCases(allCaseNumbers);
    
    // Get unique case numbers from interactions
    const interactionCaseNumbers = [...new Set(allInteractions.map((i: any) => i.case_number))];
    
    // Find cases that exist in interactions but not in cases table
    const orphanInteractionCaseNumbers = interactionCaseNumbers.filter(
      cn => !allCaseNumbers.includes(cn)
    );
    
    return NextResponse.json({
      summary: {
        totalCases: allCases.length,
        totalWorkspaces: allWorkspaces.length,
        davidWorkspaceId: davidWorkspace?.id,
        davidWorkspaceName: davidWorkspace?.name,
        casesInDavidWorkspace: davidCases.length,
        totalInteractions: allInteractions.length,
        uniqueCaseNumbersInCases: allCaseNumbers.length,
        uniqueCaseNumbersInInteractions: interactionCaseNumbers.length,
        orphanInteractionCaseNumbers: orphanInteractionCaseNumbers.length
      },
      allCaseNumbers,
      davidCaseNumbers,
      interactionCaseNumbers,
      orphanInteractionCaseNumbers,
      casesDetail: allCases.map((c: any) => ({
        id: c.id,
        caseNumber: c.caseNumber,
        clientName: c.clientName,
        workspaceId: c.workspaceId,
        workspaceName: allWorkspaces.find((w: any) => w.id === c.workspaceId)?.name || 'No workspace'
      })),
      davidWorkspace,
      interactionsPerCase: interactionCaseNumbers.map(cn => ({
        caseNumber: cn,
        count: allInteractions.filter((i: any) => i.case_number === cn).length,
        existsInCasesTable: allCaseNumbers.includes(cn),
        inDavidWorkspace: davidCaseNumbers.includes(cn)
      }))
    });
  } catch (error) {
    console.error('Check all data error:', error);
    return NextResponse.json({ 
      error: 'Failed to check data', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}