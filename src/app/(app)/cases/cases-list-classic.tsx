"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusCircle, ChevronDown, ChevronUp, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, FilterX, Search, X, Trash2, Database, RefreshCw } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NewCaseForm } from "../cases/new-case-form";
import { useSessionStorage } from "@/hooks/use-session-storage";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCases } from "@/hooks/use-database";
import { useToast } from "@/hooks/use-toast";
/* Removed unused/invalid import - no exported member useAuthFetch */
import CommunicationLog from "../cases/[caseId]/communication-log";
import RequireWorkspace from "@/components/RequireWorkspace";
import type {
  CaseFrontend as Case,
  WorkspaceFrontend as Workspace,
  ContactFrontend as Contact
} from "@/lib/database-schema";

interface CasesListClientProps {
  initialCases: Case[];
  initialContacts: Contact[];
  initialWorkspaces: Workspace[];
}

type CaseFormValues = {
  caseNumber?: string;
  rentalCompany: string;
  lawyer?: string;
  clientName: string;
  clientPhone?: string;
  clientEmail?: string;
  clientStreetAddress?: string;
  clientSuburb?: string;
  clientState?: string;
  clientPostcode?: string;
  clientClaimNumber?: string;
  clientInsuranceCompany?: string;
  clientInsurer?: string;
  atFaultPartyName: string;
  atFaultPartyPhone?: string;
  atFaultPartyEmail?: string;
  atFaultPartyStreetAddress?: string;
  atFaultPartySuburb?: string;
  atFaultPartyState?: string;
  atFaultPartyPostcode?: string;
  atFaultPartyClaimNumber?: string;
  atFaultPartyInsuranceCompany?: string;
  atFaultPartyInsurer?: string;
};

const statusOptions = ['New Matter', 'Customer Contacted', 'Awaiting Approval', 'Bike Delivered', 'Bike Returned', 'Demands Sent', 'Awaiting Settlement', 'Settlement Agreed', 'Paid', 'Closed'];

export default function CasesListClassic({ 
  initialCases, 
  initialContacts, 
  initialWorkspaces 
}: CasesListClientProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { create: createCase } = useCases();
  const { id: workspaceIdCtx, name: workspaceNameCtx, backToMain, role: workspaceRole } = useWorkspace();
  const [currentUser] = useSessionStorage<any>("currentUser", null);
  const [hydratedCases, setHydratedCases] = useState<Case[]>(initialCases);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  
  console.log('[CasesListClient] Workspace Context:', { 
    workspaceIdCtx, 
    workspaceNameCtx, 
    workspaceRole,
    currentUser: currentUser?.email
  });

  // Sorting state
  const [sortField, setSortField] = useState<'caseNumber' | 'clientName' | 'lastUpdated' | 'status'>('lastUpdated');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isClient, setIsClient] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreatingMock, setIsCreatingMock] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (isClient) {
      setHydratedCases(initialCases);
    }
  }, [isClient, initialCases]);
  
  // Refresh when workspace context changes
  useEffect(() => {
    if (isClient) {
      console.log('[CasesListClient] Workspace changed, refreshing view:', workspaceIdCtx);
      // Force re-render of filtered cases when workspace changes
      setHydratedCases([...initialCases]);
    }
  }, [workspaceIdCtx, isClient, initialCases]);
  
  const toggleRow = (caseNumber: string) => {
    setOpenRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(caseNumber)) {
        newSet.delete(caseNumber);
      } else {
        newSet.add(caseNumber);
      }
      return newSet;
    });
  };

  const handleAddCase = async (data: Omit<CaseFormValues, 'caseNumber'> & { workspaceId?: string }) => {
    try {
      const newCaseData: any = {
        ...data,
        caseNumber: `CASE-${Date.now().toString().slice(-6)}`,
        status: 'New Matter' as const,
        lastUpdated: 'Just now',
        invoiced: 0,
        reserve: 0,
        agreed: 0,
        paid: 0,
        workspaceId: data.workspaceId || workspaceIdCtx,
      };
      
      // If workspace user, automatically assign the case to their contact
      if (currentUser?.role === 'workspace_user' && currentUser.contactId) {
        // Determine if the user's contact is a lawyer or rental company
        const userContact = initialContacts.find(c => c.id === currentUser.contactId);
        if (userContact) {
          if (userContact.type === 'Lawyer') {
            newCaseData.assigned_lawyer_id = currentUser.contactId;
          } else if (userContact.type === 'Rental Company') {
            newCaseData.assigned_rental_company_id = currentUser.contactId;
          }
        }
      }
      
      await createCase(newCaseData);
      
      // Trigger on-demand revalidation
      await fetch('/api/revalidate/cases', { method: 'POST' });
      
      // Refresh the page to show updated data
      window.location.reload();
    } catch (error) {
      console.error('Error creating case:', error);
    }
  };
  
  const handleStatusChange = async (caseNumber: string, newStatus: Case['status']) => {
    try {
      // Find the case to get its id for the API call
      const target = hydratedCases.find(c => c.caseNumber === caseNumber);
      const caseIdOrNumber = target?.id || caseNumber; // API supports id or caseNumber

      const res = await fetch(`/api/cases/${caseIdOrNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, last_updated: new Date().toISOString() })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('Failed to update status:', res.status, text);
      }

      // Update local state optimistically
      setHydratedCases(prev => prev.map(c =>
        c.caseNumber === caseNumber ? { ...c, status: newStatus, lastUpdated: new Date().toISOString() } : c
      ));
    } catch (e) {
      console.error('Error updating case status:', e);
    }
  }

  const handleDeleteCase = async (caseId: string, caseNumber: string) => {
    if (!confirm(`Are you sure you want to delete case ${caseNumber}? This will also delete all associated documents and cannot be undone.`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/cases/${caseId}/delete`, {
        method: 'DELETE',
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Case deleted:', result);
        
        // Trigger on-demand revalidation
        await fetch('/api/revalidate/cases', { method: 'POST' });
        
        // Refresh the cases list
        window.location.reload();
      } else {
        const error = await response.json();
        alert(`Failed to delete case: ${error.error}`);
      }
    } catch (error) {
      console.error('Error deleting case:', error);
      alert('Failed to delete case. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCreateMockCases = async () => {
    if (!confirm('This will create 5 mock cases with sample data. Continue?')) {
      return;
    }

    setIsCreatingMock(true);
    try {
      const response = await fetch('/api/cases/create-mock', {
        method: 'POST',
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Mock cases created:', result);
        const skipped = typeof result.skippedExisting === 'number' ? result.skippedExisting : 0;
        const errorsLen = Array.isArray(result.errors) ? result.errors.length : 0;
        const extra =
          skipped || errorsLen
            ? ` (skipped existing: ${skipped}${errorsLen ? `, errors: ${errorsLen}` : ''})`
            : '';
        alert(`Successfully created ${result.createdCount} mock cases${extra}`);
        
        // Trigger on-demand revalidation
        await fetch('/api/revalidate/cases', { method: 'POST' });
        
        // Refresh the page
        window.location.reload();
      } else {
        const errorText = await response.text().catch(() => '');
        alert(`Failed to create mock cases: ${errorText || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error creating mock cases:', error);
      alert('Failed to create mock cases. Please try again.');
    } finally {
      setIsCreatingMock(false);
    }
  };

  const clearWorkspaceFilter = () => {
    // Use context so the entire app is consistent
    backToMain();
  };

  const handleWorkspaceAssignment = async (caseNumber: string, newWorkspaceId: string) => {
    const target = hydratedCases.find(c => c.caseNumber === caseNumber);
    const caseIdOrNumber = target?.id || caseNumber;

    console.log('[Workspace Assignment] Updating case:', caseNumber, 'to workspace:', newWorkspaceId);

    // Persist to API
    try {
      const response = await fetch(`/api/cases/${caseIdOrNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: newWorkspaceId === 'none' ? null : newWorkspaceId,
          last_updated: new Date().toISOString()
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Workspace Assignment] API Error:', error);
        alert(`Failed to update workspace assignment: ${error}`);
        return;
      }

      console.log('[Workspace Assignment] Successfully updated');

      // Only update UI if API call succeeded
      setHydratedCases(prevCases =>
        prevCases.map(c =>
          c.caseNumber === caseNumber
            ? { ...c, workspaceId: newWorkspaceId === 'none' ? undefined : newWorkspaceId, lastUpdated: new Date().toISOString() }
            : c
        )
      );
    } catch (e) {
      console.error('[Workspace Assignment] Failed:', e);
      alert('Failed to update workspace assignment. Please try again.');
    }
  };

  const handleLawyerAssignment = async (caseNumber: string, lawyerId: string) => {
    const target = hydratedCases.find(c => c.caseNumber === caseNumber);
    const caseIdOrNumber = target?.id || caseNumber;

    console.log('[Lawyer Assignment] Updating case:', caseNumber, 'lawyer:', lawyerId);

    // Persist to API
    try {
      const response = await fetch(`/api/cases/${caseIdOrNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_lawyer_id: lawyerId === 'none' ? null : lawyerId,
          last_updated: new Date().toISOString()
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Lawyer Assignment] API Error:', error);
        alert(`Failed to update lawyer assignment: ${error}`);
        return;
      }

      console.log('[Lawyer Assignment] Successfully updated');

      // Only update UI if API call succeeded
      setHydratedCases(prevCases =>
        prevCases.map(c =>
          c.caseNumber === caseNumber
            ? { ...c, assigned_lawyer_id: lawyerId === 'none' ? undefined : lawyerId, lastUpdated: new Date().toISOString() }
            : c
        )
      );
    } catch (e) {
      console.error('[Lawyer Assignment] Failed:', e);
      alert('Failed to update lawyer assignment. Please try again.');
    }
  };

  const handleRentalCompanyAssignment = async (caseNumber: string, rentalCompanyId: string) => {
    const target = hydratedCases.find(c => c.caseNumber === caseNumber);
    const caseIdOrNumber = target?.id || caseNumber;

    console.log('[Rental Assignment] Updating case:', caseNumber, 'rental company:', rentalCompanyId);

    // Persist to API
    try {
      const response = await fetch(`/api/cases/${caseIdOrNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_rental_company_id: rentalCompanyId === 'none' ? null : rentalCompanyId,
          last_updated: new Date().toISOString()
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Rental Assignment] API Error:', error);
        alert(`Failed to update rental company assignment: ${error}`);
        return;
      }

      console.log('[Rental Assignment] Successfully updated');

      // Only update UI if API call succeeded
      setHydratedCases(prevCases =>
        prevCases.map(c =>
          c.caseNumber === caseNumber
            ? { ...c, assigned_rental_company_id: rentalCompanyId === 'none' ? undefined : rentalCompanyId, lastUpdated: new Date().toISOString() }
            : c
        )
      );
    } catch (e) {
      console.error('[Rental Assignment] Failed:', e);
      alert('Failed to update rental company assignment. Please try again.');
    }
  };

  const handleInsurerAssignment = async (caseNumber: string, insurerId: string) => {
    const insurerName = insurerId === 'none' ? '' : getContactName(insurerId);
    const target = hydratedCases.find(c => c.caseNumber === caseNumber);
    const caseIdOrNumber = target?.id || caseNumber;

    console.log('[Insurer Assignment] Updating case:', caseNumber, 'insurer:', insurerId, 'name:', insurerName);

    try {
      const response = await fetch(`/api/cases/${caseIdOrNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          at_fault_party_insurance_company: insurerName || null, 
          last_updated: new Date().toISOString() 
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Insurer Assignment] API Error:', error);
        alert(`Failed to update insurer assignment: ${error}`);
        return;
      }

      console.log('[Insurer Assignment] Successfully updated');

      // Only update UI if API call succeeded
      setHydratedCases(prev => prev.map(c =>
        c.caseNumber === caseNumber 
          ? { ...c, atFaultPartyInsuranceCompany: insurerName || undefined, lastUpdated: new Date().toISOString() } 
          : c
      ));
    } catch (e) {
      console.error('[Insurer Assignment] Failed:', e);
      alert('Failed to update insurer assignment. Please try again.');
    }
  };

  // Get filtered contacts for dropdowns
  const getLawyerContacts = () => (initialContacts as Contact[]).filter(c => c.type === 'Lawyer');
  const getRentalCompanyContacts = () => (initialContacts as Contact[]).filter(c => c.type === 'Rental Company');
  const getInsurerContacts = () => (initialContacts as Contact[]).filter(c => c.type === 'Insurer');

  // Get contact name by ID
  const getContactName = (contactId?: string) => {
    if (!contactId) return '';
    const contact = (initialContacts as Contact[]).find(c => c.id === contactId);
    return contact?.name || '';
  };

  const getInsurerIdFromName = (name?: string) => {
    if (!name) return 'none';
    const match = getInsurerContacts().find(i => i.name === name);
    return match?.id || 'none';
  };

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: typeof sortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 text-gray-400" />;
    }
    return sortDirection === 'asc'
      ? <ArrowUp className="h-4 w-4 text-blue-600" />
      : <ArrowDown className="h-4 w-4 text-blue-600" />;
  };

  // Search filtering function
  const searchFilter = useMemo(() => {
    if (!searchQuery.trim()) return () => true;
    
    const query = searchQuery.toLowerCase().trim();
    
    return (c: Case) => {
      // Search in case number
      if (c.caseNumber?.toLowerCase().includes(query)) return true;
      
      // Search in not-at-fault client (NAF) details
      if (c.clientName?.toLowerCase().includes(query)) return true;
      if (c.clientPhone?.toLowerCase().includes(query)) return true;
      if (c.clientEmail?.toLowerCase().includes(query)) return true;
      if (c.clientSuburb?.toLowerCase().includes(query)) return true;
      if (c.clientPostcode?.toLowerCase().includes(query)) return true;
      if (c.clientClaimNumber?.toLowerCase().includes(query)) return true;
      if (c.clientVehicleRego?.toLowerCase().includes(query)) return true;
      
      // Search in at-fault party details
      if (c.atFaultPartyName?.toLowerCase().includes(query)) return true;
      if (c.atFaultPartyPhone?.toLowerCase().includes(query)) return true;
      if (c.atFaultPartyEmail?.toLowerCase().includes(query)) return true;
      if (c.atFaultPartySuburb?.toLowerCase().includes(query)) return true;
      if (c.atFaultPartyPostcode?.toLowerCase().includes(query)) return true;
      if (c.atFaultPartyClaimNumber?.toLowerCase().includes(query)) return true;
      if (c.atFaultPartyVehicleRego?.toLowerCase().includes(query)) return true;
      
      return false;
    };
  }, [searchQuery]);
  
  // Status filter per-workspace (unique key per active workspace)
  const statusKey = `cases:statusFilter:${workspaceIdCtx || 'MAIN'}`;
  const [statusFilter, setStatusFilter] = useSessionStorage<Case['status'] | 'ALL'>(statusKey, 'ALL');

  const filteredAndSortedCases = hydratedCases
    .filter(c => {
      // First apply workspace/user visibility rules
      let visibilityPassed = false;
      
      // If workspace user, they should only see cases in their workspace
      if (currentUser?.role === 'workspace_user') {
        // Workspace users see ALL cases assigned to their workspace
        const userWorkspaceId = currentUser.workspaceId || workspaceIdCtx;
        visibilityPassed = c.workspaceId === userWorkspaceId;
        
        // No additional filtering by contact assignment - show ALL workspace cases
        // This ensures workspace users can see all cases in their workspace
      } else {
        // Admin/developer users: filter by active workspace context id. If undefined (Main) show all
        if (workspaceIdCtx) {
          visibilityPassed = c.workspaceId === workspaceIdCtx;
        } else {
          visibilityPassed = true; // Main Workspace shows all
        }
      }
      
      // Debug logging
      if (c.workspaceId) {
        console.log('[Filter Debug]', {
          caseNumber: c.caseNumber,
          caseWorkspaceId: c.workspaceId,
          workspaceIdCtx,
          userRole: currentUser?.role,
          visibilityPassed
        });
      }
      
      // If visibility check fails, exclude the case
      if (!visibilityPassed) return false;
      
      // Apply optional status filter
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      // Then apply search filter
      return searchFilter(c);
    })
    .sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (sortField) {
        case 'caseNumber':
          aValue = a.caseNumber;
          bValue = b.caseNumber;
          break;
        case 'clientName':
          aValue = a.clientName;
          bValue = b.clientName;
          break;
        case 'status':
          aValue = a.status;
          bValue = b.status;
          break;
        case 'lastUpdated':
        default: {
          // Robust timestamp parsing: supports Date objects and ISO strings
          const getMs = (v: Date | string | undefined) => {
            if (!v) return 0;
            if (v instanceof Date) return v.getTime();
            if (v === 'Just now') return Date.now();
            const t = Date.parse(v);
            return Number.isNaN(t) ? 0 : t;
          };
          aValue = getMs(a.lastUpdated as any);
          bValue = getMs(b.lastUpdated as any);
          break;
        }
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        const comparison = aValue.localeCompare(bValue);
        return sortDirection === 'asc' ? comparison : -comparison;
      } else {
        const comparison = (aValue as number) - (bValue as number);
        return sortDirection === 'asc' ? comparison : -comparison;
      }
    });

  // Calculate search results count
  const searchResultsCount = useMemo(() => {
    return filteredAndSortedCases.length;
  }, [filteredAndSortedCases]);
  
  if (!isClient) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading cases...</div>;
  }

  // If no current user, show loading
  if (!currentUser) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Authenticating...</div>;
  }
  

  return (
    <RequireWorkspace>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Cases</h1>
        <div className="flex gap-2">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <PlusCircle className="mr-2 h-4 w-4" /> New Case
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-4xl h-[90vh]">
            <DialogHeader>
              <DialogTitle>Create New Case</DialogTitle>
              <DialogDescription>
                Enter case details for both parties.
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-full pr-6">
              <NewCaseForm onCaseCreate={handleAddCase} setDialogOpen={setIsDialogOpen} activeWorkspaceId={workspaceIdCtx} />
            </ScrollArea>
          </DialogContent>
        </Dialog>
        </div>
      </div>
      
      {/* Table View */}
      {/* Search Field */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search cases by number, client, at-fault party, rego, claim number, suburb, postcode..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-10"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchQuery('')}
              className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 w-8 p-0 hover:bg-muted"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Clear search</span>
            </Button>
          )}
        </div>
        {searchQuery && (
          <div className="text-sm text-muted-foreground">
            {searchResultsCount} result{searchResultsCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
           <div className="flex flex-wrap items-center justify-between gap-y-4">
              <div className="flex-1 min-w-[250px]">
                  {workspaceIdCtx ? (
                    <>
                      <CardTitle>Workspace: {workspaceNameCtx || 'Loading...'}</CardTitle>
                      <CardDescription>
                        Showing cases filtered by workspace
                      </CardDescription>
                    </>
                  ) : (
                    <>
                      <CardTitle>Main Workspace</CardTitle>
                      <CardDescription>Showing all cases across all workspaces</CardDescription>
                    </>
                  )}
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm text-muted-foreground">
                  Sorted by {sortField.replace(/([A-Z])/g, ' $1').toLowerCase()} ({sortDirection === 'asc' ? 'ascending' : 'descending'})
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSortField('lastUpdated');
                    setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
                  }}
                >
                  Toggle Last Updated {sortDirection === 'asc' ? <ArrowUp className="ml-1 h-4 w-4"/> : <ArrowDown className="ml-1 h-4 w-4"/>}
                </Button>
              </div>
          </div>
        </CardHeader>
        
        <div className="px-6 pb-4 border-b">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Only show workspace info for workspace users */}
              {currentUser?.role === 'workspace_user' && workspaceIdCtx ? (
                  <p className="text-sm text-muted-foreground">Viewing your assigned cases only.</p>
              ) : null}

              {/* Status filter */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Status filter:</span>
                   <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                  <SelectTrigger className="h-8 w-[200px] text-xs">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All statuses</SelectItem>
                    {statusOptions.map(opt => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {statusFilter !== 'ALL' && (
                  <Button variant="ghost" size="sm" onClick={() => setStatusFilter('ALL')}>
                    <X className="mr-1 h-4 w-4"/> Remove filter
                  </Button>
                )}
              </div>
            </div>
        </div>
        
        <CardContent className="pt-4">
          <div className="rounded-md border overflow-x-hidden">
            <Table className="table-fixed w-full whitespace-normal">
                <TableHeader className="hidden md:table-header-group">
                    <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>
                          <Button
                            variant="ghost"
                            className="h-auto p-0 font-medium hover:bg-transparent flex items-center gap-1"
                            onClick={() => handleSort('caseNumber')}
                          >
                            Case Number
                            {getSortIcon('caseNumber')}
                          </Button>
                        </TableHead>
                        <TableHead>
                          <Button
                            variant="ghost"
                            className="h-auto p-0 font-medium hover:bg-transparent flex items-center gap-1"
                            onClick={() => handleSort('clientName')}
                          >
                            Client
                            {getSortIcon('clientName')}
                          </Button>
                        </TableHead>
                        <TableHead className="hidden xl:table-cell">Assigned Lawyer</TableHead>
                        <TableHead className="hidden xl:table-cell">Assigned Rental Company</TableHead>
                        <TableHead className="hidden lg:table-cell">At-Fault Insurer</TableHead>
                        <TableHead className="hidden lg:table-cell">Workspace</TableHead>
                        <TableHead>
                          <Button
                            variant="ghost"
                            className="h-auto p-0 font-medium hover:bg-transparent flex items-center gap-1"
                            onClick={() => handleSort('status')}
                          >
                            Status
                            {getSortIcon('status')}
                          </Button>
                        </TableHead>
                        <TableHead>
                          <Button
                            variant="ghost"
                            className="h-auto p-0 font-medium hover:bg-transparent flex items-center gap-1"
                            onClick={() => handleSort('lastUpdated')}
                          >
                            Last Updated
                            {getSortIcon('lastUpdated')}
                          </Button>
                        </TableHead>
                        <TableHead>Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                {filteredAndSortedCases.map((c) => {
                  const isOpen = openRows.has(c.caseNumber);
                  return (
                    <React.Fragment key={c.caseNumber}>
                      {/* Desktop view - single row */}
                      <TableRow data-test="case-row" className="hidden md:table-row">
                          <TableCell className="w-12">
                            <Button 
                              variant="ghost" 
                              size="icon"
                              className="h-8 w-8" 
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRow(c.caseNumber);
                              }}
                            >
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">{c.caseNumber}</TableCell>
                          <TableCell>{c.clientName}</TableCell>
                          <TableCell className="hidden xl:table-cell">
                            <Select
                              value={c.assigned_lawyer_id || "none"}
                              onValueChange={(lawyerId) => handleLawyerAssignment(c.caseNumber, lawyerId)}
                              disabled={currentUser?.role === 'workspace_user' && currentUser.contactId !== c.assigned_lawyer_id}
                            >
                              <SelectTrigger className="h-8 max-w-[140px] text-xs">
                                <SelectValue placeholder="No lawyer" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No lawyer</SelectItem>
                                {(currentUser?.role === 'workspace_user' ?
                                  getLawyerContacts().filter((lawyer: Contact) => lawyer.id === currentUser.contactId) :
                                  getLawyerContacts()
                                ).map((lawyer: Contact) => (
                                  <SelectItem key={lawyer.id} value={lawyer.id}>
                                    {lawyer.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="hidden xl:table-cell">
                            <Select
                              value={c.assigned_rental_company_id || "none"}
                              onValueChange={(rentalCompanyId) => handleRentalCompanyAssignment(c.caseNumber, rentalCompanyId)}
                              disabled={currentUser?.role === 'workspace_user' && currentUser.contactId !== c.assigned_rental_company_id}
                            >
                              <SelectTrigger className="h-8 max-w-[140px] text-xs">
                                <SelectValue placeholder="No rental company" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No rental company</SelectItem>
                                {(currentUser?.role === 'workspace_user' ?
                                  getRentalCompanyContacts().filter((company: Contact) => company.id === currentUser.contactId) :
                                  getRentalCompanyContacts()
                                ).map((company: Contact) => (
                                  <SelectItem key={company.id} value={company.id}>
                                    {company.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <Select
                              value={getInsurerIdFromName(c.atFaultPartyInsuranceCompany)}
                              onValueChange={(insurerId) => handleInsurerAssignment(c.caseNumber, insurerId)}
                            >
                              <SelectTrigger className="h-8 max-w-[160px] text-xs">
                                <SelectValue placeholder="No insurer" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No insurer</SelectItem>
                                {getInsurerContacts().map((ins: Contact) => (
                                  <SelectItem key={ins.id} value={ins.id}>{ins.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <Select
                              value={c.workspaceId || "none"}
                              onValueChange={(workspaceId) => handleWorkspaceAssignment(c.caseNumber, workspaceId)}
                            >
                              <SelectTrigger className="h-8 max-w-[140px] text-xs">
                                <SelectValue placeholder="No workspace" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No workspace</SelectItem>
                                {(initialWorkspaces as Workspace[]).map((workspace: Workspace) => {
                                  const contact = (initialContacts as Contact[]).find(c => c.id === workspace.contactId);
                                  return (
                                    <SelectItem key={workspace.id} value={workspace.id}>
                                      {contact?.name || workspace.name}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select value={c.status} onValueChange={(newStatus) => handleStatusChange(c.caseNumber, newStatus as Case['status'])}>
                                <SelectTrigger className="h-8 max-w-[120px] text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {statusOptions.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                                </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>{c.lastUpdated instanceof Date ? c.lastUpdated.toLocaleString() : c.lastUpdated}</TableCell>
                          <TableCell>
                            <div className="flex gap-2 flex-wrap">
                              <Button variant="outline" size="sm" onClick={() => router.push(`/cases/${c.id}`)}>
                                View Details
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDeleteCase(c.id!, c.caseNumber)}
                                disabled={isDeleting}
                              >
                                {isDeleting ? (
                                  <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </TableCell>
                      </TableRow>
                      
                      {/* Mobile view - two rows */}
                      <TableRow data-test="case-row-mobile" className="md:hidden border-b-0">
                          <TableCell colSpan={10} className="p-3">
                            <div className="space-y-3">
                              {/* First row - Case Number, Client Name, Status, Actions */}
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm">{c.caseNumber}</div>
                                  <div className="text-sm text-muted-foreground truncate">{c.clientName}</div>
                                </div>
                                <Select value={c.status} onValueChange={(newStatus) => handleStatusChange(c.caseNumber, newStatus as Case['status'])}>
                                  <SelectTrigger className="h-8 w-[130px] text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {statusOptions.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                <Button variant="outline" size="sm" onClick={() => router.push(`/cases/${c.id}`)}>
                                  View
                                </Button>
                              </div>
                              
                              {/* Second row - Additional info and expand button */}
                              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                <div className="flex flex-wrap gap-3">
                                  <div>
                                    <span className="font-medium">Lawyer:</span> {getContactName(c.assigned_lawyer_id) || 'None'}
                                  </div>
                                  <div>
                                    <span className="font-medium">Rental:</span> {getContactName(c.assigned_rental_company_id) || 'None'}
                                  </div>
                                  <div>
                                    <span className="font-medium">Updated:</span> {c.lastUpdated instanceof Date ? c.lastUpdated.toLocaleDateString() : c.lastUpdated}
                                  </div>
                                </div>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-8 px-2" 
                                  onClick={() => toggleRow(c.caseNumber)}
                                >
                                  {isOpen ? (
                                    <>
                                      <ChevronUp className="h-4 w-4 mr-1" />
                                      <span className="text-xs">Less</span>
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown className="h-4 w-4 mr-1" />
                                      <span className="text-xs">More</span>
                                    </>
                                  )}
                                </Button>
                              </div>
                            </div>
                          </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={10} className="p-0">
                             <div className="p-4 bg-muted/50">
                              <CommunicationLog caseNumber={c.caseNumber} />
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  )
                })}
                </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      </div>
    </RequireWorkspace>
  );
}