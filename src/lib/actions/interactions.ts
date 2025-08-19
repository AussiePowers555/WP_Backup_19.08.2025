'use server';

import { db, ensureDatabaseInitialized } from '@/lib/database';
import { revalidatePath, revalidateTag } from 'next/cache';
import { 
  Interaction, 
  InteractionFeedView, 
  CreateInteractionData, 
  UpdateInteractionData, 
  InteractionFilters, 
  InteractionSortOptions,
  PaginatedInteractions 
} from '@/types/interaction';

// Database connection helper
async function executeQuery(query: string, params: any[] = []) {
  try {
    await ensureDatabaseInitialized();
    const result = await db.query(query, params);
    return { success: true, data: result };
  } catch (error) {
    console.error('Database query error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown database error' 
    };
  }
}

// Get paginated interactions with filters and sorting
export async function getInteractions(
  page: number = 1,
  limit: number = 20,
  filters: InteractionFilters = {},
  sort: InteractionSortOptions = { field: 'timestamp', direction: 'desc' },
  workspaceId?: string,
  contactId?: string  // For workspace users to see only their assigned cases' interactions
): Promise<{ success: boolean; data?: PaginatedInteractions; error?: string }> {
  try {
    console.log('[DEBUG] getInteractions called with:', { page, limit, filters, sort, workspaceId, contactId });
    
    const offset = (page - 1) * limit;
    
    // Build WHERE clauses
    const whereConditions: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;
    
    // Filter by workspace for all users (unless viewing MAIN/all)
    if (workspaceId && workspaceId !== 'MAIN') {
      // Filter interactions by the workspace_id of their associated case
      // Join with cases table to get workspace filtering
      whereConditions.push(`c.workspace_id = $${paramIndex++}`);
      queryParams.push(workspaceId);
    }
    
    // Additional filter by contact assignment if needed
    if (contactId) {
      // Show interactions for cases where this contact is assigned as lawyer or rental company
      whereConditions.push(`(c.assigned_lawyer_id = $${paramIndex} OR c.assigned_rental_company_id = $${paramIndex})`);
      queryParams.push(contactId);
      paramIndex++;
    }
    
    if (filters.caseNumber) {
      whereConditions.push(`i.case_number ILIKE $${paramIndex++}`);
      queryParams.push(`%${filters.caseNumber}%`);
    }
    
    if (filters.caseId) {
      whereConditions.push(`c.id = $${paramIndex++}`);
      queryParams.push(filters.caseId);
    }
    
    // These columns don't exist in case_interactions table, skip them
    // if (filters.interactionType && filters.interactionType.length > 0) {
    //   whereConditions.push(`i.interaction_type = ANY($${paramIndex++})`);
    //   queryParams.push(filters.interactionType);
    // }
    
    // if (filters.priority && filters.priority.length > 0) {
    //   whereConditions.push(`i.priority = ANY($${paramIndex++})`);
    //   queryParams.push(filters.priority);
    // }
    
    // if (filters.status && filters.status.length > 0) {
    //   whereConditions.push(`i.status = ANY($${paramIndex++})`);
    //   queryParams.push(filters.status);
    // }
    
    if (filters.dateFrom) {
      whereConditions.push(`i.timestamp >= $${paramIndex++}`);
      queryParams.push(filters.dateFrom);
    }
    
    if (filters.dateTo) {
      whereConditions.push(`i.timestamp <= $${paramIndex++}`);
      queryParams.push(filters.dateTo);
    }
    
    if (filters.searchQuery) {
      whereConditions.push(`(
        to_tsvector('english', i.situation || ' ' || i.action || ' ' || i.outcome) 
        @@ plainto_tsquery('english', $${paramIndex++})
      )`);
      queryParams.push(filters.searchQuery);
    }
    
    // Tags column doesn't exist in case_interactions
    // if (filters.tags && filters.tags.length > 0) {
    //   whereConditions.push(`i.tags && $${paramIndex++})`);
    //   queryParams.push(filters.tags);
    // }
    
    // Add case-related filters
    if (filters.insuranceCompany) {
      whereConditions.push(`c.client_insurance_company ILIKE $${paramIndex++}`);
      queryParams.push(`%${filters.insuranceCompany}%`);
    }
    
    if (filters.lawyerAssigned) {
      whereConditions.push(`c.lawyer ILIKE $${paramIndex++}`);
      queryParams.push(`%${filters.lawyerAssigned}%`);
    }
    
    if (filters.rentalCompany) {
      whereConditions.push(`c.rental_company ILIKE $${paramIndex++}`);
      queryParams.push(`%${filters.rentalCompany}%`);
    }
    
    const whereClause = whereConditions.length > 0 ? whereConditions.join(' AND ') : '';
    
    // Build ORDER BY clause - using actual columns
    const orderBy = `ORDER BY i.${sort.field === 'timestamp' ? 'timestamp' : 
                                sort.field === 'caseNumber' ? 'case_number' :
                                'timestamp'} ${sort.direction.toUpperCase()}`;
    
    // Main query - using actual columns from case_interactions table
    const query = `
      SELECT 
        i.id,
        i.case_number as "caseNumber",
        i.source,
        i.method,
        i.situation,
        i.action,
        i.outcome,
        i.timestamp,
        i.created_at as "createdAt",
        i.updated_at as "updatedAt",
        c.id as "caseId",
        c.workspace_id as "workspaceId",
        c.client_name as "caseHirerName",
        c.accident_date as "incidentDate",
        c.status as "caseStatus",
        c.client_insurance_company as "insuranceCompany",
        c.lawyer as "lawyerAssigned",
        c.rental_company as "rentalCompany"
      FROM case_interactions i
      LEFT JOIN cases c ON i.case_number = c.case_number
      ${whereClause ? 'WHERE ' + whereClause : ''}
      ${orderBy}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    
    queryParams.push(limit + 1, offset); // Get one extra to check if there are more
    
    console.log('[DEBUG] Executing query:', query);
    console.log('[DEBUG] Query params:', queryParams);
    
    const result = await executeQuery(query, queryParams);
    
    if (!result.success) {
      console.error('[DEBUG] Query failed:', result.error);
      return { success: false, error: result.error };
    }
    
    const rawInteractions = result.data?.rows || [];
    const hasMore = rawInteractions.length > limit;
    
    if (hasMore) {
      rawInteractions.pop(); // Remove the extra record
    }
    
    // Map the raw data to InteractionFeedView format
    const interactions = rawInteractions.map((row: any) => ({
      // Basic interaction data from case_interactions table
      id: row.id,
      caseNumber: row.caseNumber,
      caseId: row.caseId,
      timestamp: row.timestamp,
      
      // Map the actual columns to expected fields
      situation: row.situation,
      actionTaken: row.action || '', // 'action' column mapped to 'actionTaken'
      outcome: row.outcome,
      
      // Default values for fields that don't exist in our table
      interactionType: 'note' as const,
      priority: 'medium' as const,
      status: 'completed' as const,
      tags: [],
      attachments: [],
      
      // User tracking
      createdBy: row.source || 'System',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      workspaceId: row.workspaceId,
      
      // Case details from joined cases table
      caseHirerName: row.caseHirerName,
      incidentDate: row.incidentDate,
      caseStatus: row.caseStatus,
      insuranceCompany: row.insuranceCompany,
      lawyerAssigned: row.lawyerAssigned,
      rentalCompany: row.rentalCompany,
      
      // Additional metadata
      contactName: row.method || undefined,
      createdByName: row.source,
      createdByEmail: undefined
    }))
    
    // Get total count for pagination info
    const countQuery = `
      SELECT COUNT(*) as total
      FROM case_interactions i
      LEFT JOIN cases c ON i.case_number = c.case_number
      ${whereClause ? 'WHERE ' + whereClause : ''}
    `;
    
    const countResult = await executeQuery(countQuery, queryParams.slice(0, -2)); // Remove LIMIT and OFFSET params
    const totalCount = parseInt(countResult.data?.rows[0]?.total || '0');
    
    return {
      success: true,
      data: {
        interactions: interactions as InteractionFeedView[],
        totalCount,
        hasMore,
        nextCursor: hasMore ? (page + 1).toString() : undefined
      }
    };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to fetch interactions' 
    };
  }
}

// Create new interaction
export async function createInteraction(
  data: CreateInteractionData,
  userId: string,
  workspaceId: string
): Promise<{ success: boolean; data?: Interaction; error?: string }> {
  try {
    const query = `
      INSERT INTO interactions (
        case_number, case_id, interaction_type, contact_name, contact_phone, 
        contact_email, situation, action_taken, outcome, priority, status, 
        tags, created_by, workspace_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      )
      RETURNING *
    `;
    
    const params = [
      data.caseNumber,
      data.caseId,
      data.interactionType,
      data.contactName || null,
      data.contactPhone || null,
      data.contactEmail || null,
      data.situation,
      data.actionTaken,
      data.outcome,
      data.priority || 'medium',
      data.status || 'completed',
      data.tags || [],
      userId,
      workspaceId
    ];
    
    const result = await executeQuery(query, params);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    const interaction = result.data?.rows[0];
    
    // Revalidate relevant paths
    revalidatePath('/interactions');
    revalidateTag('interactions');
    revalidateTag(`case-${data.caseId}`);
    
    return { 
      success: true, 
      data: {
        ...interaction,
        caseNumber: interaction.case_number,
        caseId: interaction.case_id,
        interactionType: interaction.interaction_type,
        contactName: interaction.contact_name,
        contactPhone: interaction.contact_phone,
        contactEmail: interaction.contact_email,
        actionTaken: interaction.action_taken,
        createdBy: interaction.created_by,
        updatedBy: interaction.updated_by,
        createdAt: interaction.created_at,
        updatedAt: interaction.updated_at,
        workspaceId: interaction.workspace_id,
      } as Interaction
    };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to create interaction' 
    };
  }
}

// Update interaction
export async function updateInteraction(
  data: UpdateInteractionData,
  userId: string
): Promise<{ success: boolean; data?: Interaction; error?: string }> {
  try {
    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    
    if (data.interactionType !== undefined) {
      updateFields.push(`interaction_type = $${paramIndex++}`);
      params.push(data.interactionType);
    }
    
    if (data.contactName !== undefined) {
      updateFields.push(`contact_name = $${paramIndex++}`);
      params.push(data.contactName);
    }
    
    if (data.contactPhone !== undefined) {
      updateFields.push(`contact_phone = $${paramIndex++}`);
      params.push(data.contactPhone);
    }
    
    if (data.contactEmail !== undefined) {
      updateFields.push(`contact_email = $${paramIndex++}`);
      params.push(data.contactEmail);
    }
    
    if (data.situation !== undefined) {
      updateFields.push(`situation = $${paramIndex++}`);
      params.push(data.situation);
    }
    
    if (data.actionTaken !== undefined) {
      updateFields.push(`action_taken = $${paramIndex++}`);
      params.push(data.actionTaken);
    }
    
    if (data.outcome !== undefined) {
      updateFields.push(`outcome = $${paramIndex++}`);
      params.push(data.outcome);
    }
    
    if (data.priority !== undefined) {
      updateFields.push(`priority = $${paramIndex++}`);
      params.push(data.priority);
    }
    
    if (data.status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      params.push(data.status);
    }
    
    if (data.tags !== undefined) {
      updateFields.push(`tags = $${paramIndex++}`);
      params.push(data.tags);
    }
    
    updateFields.push(`updated_by = $${paramIndex++}`);
    params.push(userId);
    
    updateFields.push(`updated_at = NOW()`);
    
    params.push(data.id);
    
    const query = `
      UPDATE interactions 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    
    const result = await executeQuery(query, params);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    const interaction = result.data?.rows[0];
    
    if (!interaction) {
      return { success: false, error: 'Interaction not found' };
    }
    
    // Revalidate relevant paths
    revalidatePath('/interactions');
    revalidateTag('interactions');
    revalidateTag(`interaction-${data.id}`);
    
    return { 
      success: true, 
      data: {
        ...interaction,
        caseNumber: interaction.case_number,
        caseId: interaction.case_id,
        interactionType: interaction.interaction_type,
        contactName: interaction.contact_name,
        contactPhone: interaction.contact_phone,
        contactEmail: interaction.contact_email,
        actionTaken: interaction.action_taken,
        createdBy: interaction.created_by,
        updatedBy: interaction.updated_by,
        createdAt: interaction.created_at,
        updatedAt: interaction.updated_at,
        workspaceId: interaction.workspace_id,
      } as Interaction
    };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to update interaction' 
    };
  }
}

// Delete interaction
export async function deleteInteraction(
  interactionId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const query = 'DELETE FROM case_interactions WHERE id = $1';
    const result = await executeQuery(query, [interactionId]);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    // Revalidate relevant paths
    revalidatePath('/interactions');
    revalidateTag('interactions');
    revalidateTag(`interaction-${interactionId}`);
    
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to delete interaction' 
    };
  }
}

// Get interaction by ID
export async function getInteractionById(
  interactionId: number
): Promise<{ success: boolean; data?: InteractionFeedView; error?: string }> {
  try {
    const query = `
      SELECT 
        i.id,
        i.case_number as "caseNumber",
        i.case_id as "caseId",
        i.interaction_type as "interactionType",
        i.timestamp,
        i.contact_name as "contactName",
        i.contact_phone as "contactPhone",
        i.contact_email as "contactEmail",
        i.situation,
        i.action_taken as "actionTaken",
        i.outcome,
        i.priority,
        i.status,
        i.tags,
        i.attachments,
        i.created_by as "createdBy",
        i.updated_by as "updatedBy",
        i.created_at as "createdAt",
        i.updated_at as "updatedAt",
        c.workspace_id as "workspaceId",
        c.client_name as "caseHirerName",
        c.accident_date as "incidentDate",
        c.status as "caseStatus",
        c.client_insurance_company as "insuranceCompany",
        c.lawyer as "lawyerAssigned",
        c.rental_company as "rentalCompany",
        i.created_by as "createdByName",
        i.created_by as "createdByEmail"
      FROM case_interactions i
      LEFT JOIN cases c ON i.case_id = c.id
      WHERE i.id = $1
    `;
    
    const result = await executeQuery(query, [interactionId]);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    const interaction = result.data?.rows[0];
    
    if (!interaction) {
      return { success: false, error: 'Interaction not found' };
    }
    
    return { success: true, data: interaction as InteractionFeedView };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to fetch interaction' 
    };
  }
}

// Get recent interactions for dashboard
export async function getRecentInteractions(
  limit: number = 5,
  workspaceId?: string
): Promise<{ success: boolean; data?: InteractionFeedView[]; error?: string }> {
  try {
    const whereClause = workspaceId ? 'WHERE i.workspace_id = $1' : '';
    const params = workspaceId ? [workspaceId, limit] : [limit];
    const limitParamIndex = workspaceId ? '$2' : '$1';
    
    const query = `
      SELECT 
        i.id,
        i.case_number as "caseNumber",
        i.case_id as "caseId",
        i.interaction_type as "interactionType",
        i.timestamp,
        i.contact_name as "contactName",
        i.situation,
        i.action_taken as "actionTaken",
        i.outcome,
        i.priority,
        i.status,
        c.client_name as "caseHirerName",
        i.created_by as "createdByName"
      FROM case_interactions i
      LEFT JOIN cases c ON i.case_id = c.id
      WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
      ${whereClause ? 'AND ' + whereClause : ''}
      ORDER BY i.timestamp DESC
      LIMIT ${limitParamIndex}
    `;
    
    const result = await executeQuery(query, params);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    return { success: true, data: result.data?.rows as InteractionFeedView[] || [] };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to fetch recent interactions' 
    };
  }
}

// Fleet Status types and functions
export interface FleetStatus {
  totalBikes: number;
  availableBikes: number;
  assignedBikes: number;
  maintenanceBikes: number;
  retiredBikes: number;
  utilizationRate: number;
  recentAssignments: {
    bikeId: string;
    bikeName: string;
    caseNumber: string;
    assignmentDate: Date;
    expectedReturn: Date;
    daysRemaining: number;
  }[];
  bikesDueToday: number;
  bikesDueTomorrow: number;
  averageRentalDuration: number;
  statusDistribution: {
    available: number;
    assigned: number;
    maintenance: number;
    retired: number;
  };
}

export async function getFleetStatus(workspaceId?: string): Promise<{ success: boolean; data?: FleetStatus; error?: string }> {
  try {
    // Query to get all bikes with their assignment details
    const bikesQuery = `
      SELECT 
        b.id,
        b.make,
        b.model,
        b.status,
        b.assignment,
        b.assigned_case_id as "assignedCaseId",
        b.assignment_start_date as "assignmentStartDate",
        b.assignment_end_date as "assignmentEndDate"
      FROM bikes b
      ${workspaceId ? 'WHERE b.workspace_id = $1' : ''}
      ORDER BY b.assignment_start_date DESC NULLS LAST
    `;
    
    const bikesResult = await executeQuery(bikesQuery, workspaceId ? [workspaceId] : []);
    
    if (!bikesResult.success) {
      return { success: false, error: bikesResult.error };
    }
    
    const bikes = bikesResult.data?.rows || [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Count bikes by status
    const statusCounts = bikes.reduce((acc: Record<string, number>, bike: any) => {
      acc[bike.status] = (acc[bike.status] || 0) + 1;
      return acc;
    }, {});
    
    // Get assigned bikes with case details
    const assignedBikes = bikes.filter((bike: any) => bike.status === 'assigned' && bike.assignedCaseId);
    
    // Calculate recent assignments (last 5)
    const recentAssignments = assignedBikes
      .filter((bike: any) => bike.assignmentStartDate)
      .slice(0, 5)
      .map((bike: any) => {
        const startDate = new Date(bike.assignmentStartDate);
        const endDate = bike.assignmentEndDate ? new Date(bike.assignmentEndDate) : new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        
        return {
          bikeId: bike.id,
          bikeName: `${bike.make} ${bike.model}`,
          caseNumber: bike.assignedCaseId || 'N/A',
          assignmentDate: startDate,
          expectedReturn: endDate,
          daysRemaining: Math.max(0, daysRemaining)
        };
      });
    
    // Count bikes due today and tomorrow
    const bikesDueToday = assignedBikes.filter((bike: any) => {
      if (!bike.assignmentEndDate) return false;
      const endDate = new Date(bike.assignmentEndDate);
      endDate.setHours(0, 0, 0, 0);
      return endDate.getTime() === today.getTime();
    }).length;
    
    const bikesDueTomorrow = assignedBikes.filter((bike: any) => {
      if (!bike.assignmentEndDate) return false;
      const endDate = new Date(bike.assignmentEndDate);
      endDate.setHours(0, 0, 0, 0);
      return endDate.getTime() === tomorrow.getTime();
    }).length;
    
    // Calculate average rental duration from completed rentals
    const completedRentalsQuery = `
      SELECT 
        b.assignment_start_date as "assignmentStartDate",
        b.assignment_end_date as "assignmentEndDate"
      FROM bikes b
      WHERE b.assignment_start_date IS NOT NULL 
        AND b.assignment_end_date IS NOT NULL 
        AND b.status = 'available'
        ${workspaceId ? 'AND b.workspace_id = $1' : ''}
    `;
    
    const completedRentalsResult = await executeQuery(completedRentalsQuery, workspaceId ? [workspaceId] : []);
    const completedRentals = completedRentalsResult.data?.rows || [];
    
    let averageRentalDuration = 7; // Default to 7 days
    if (completedRentals.length > 0) {
      const totalDuration = completedRentals.reduce((sum: number, rental: any) => {
        const start = new Date(rental.assignmentStartDate).getTime();
        const end = new Date(rental.assignmentEndDate).getTime();
        return sum + (end - start) / (1000 * 60 * 60 * 24);
      }, 0);
      averageRentalDuration = Math.round(totalDuration / completedRentals.length);
    }
    
    const totalBikes = bikes.length;
    const availableBikes = statusCounts['available'] || 0;
    const assignedBikesCount = statusCounts['assigned'] || 0;
    const maintenanceBikes = statusCounts['maintenance'] || 0;
    const retiredBikes = statusCounts['retired'] || 0;
    
    // Calculate utilization rate (assigned / (total - retired))
    const activeBikes = totalBikes - retiredBikes;
    const utilizationRate = activeBikes > 0 ? (assignedBikesCount / activeBikes) * 100 : 0;
    
    return {
      success: true,
      data: {
        totalBikes,
        availableBikes,
        assignedBikes: assignedBikesCount,
        maintenanceBikes,
        retiredBikes,
        utilizationRate: Math.round(utilizationRate),
        recentAssignments,
        bikesDueToday,
        bikesDueTomorrow,
        averageRentalDuration,
        statusDistribution: {
          available: availableBikes,
          assigned: assignedBikesCount,
          maintenance: maintenanceBikes,
          retired: retiredBikes
        }
      }
    };
  } catch (error) {
    console.error('Error fetching fleet status:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to fetch fleet status' 
    };
  }
}