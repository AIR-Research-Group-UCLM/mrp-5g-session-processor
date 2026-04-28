export interface SessionAssignment {
  id: string;
  sessionId: string;
  userId: string;
  canWrite: boolean;
  assignedBy: string;
  assignedAt: string;
}

export interface SessionForAssignment {
  id: string;
  title: string | null;
  status: string;
  ownerName: string;
  ownerId: string;
  createdAt: string;
  isAssigned: boolean;
  canWrite: boolean;
}

export interface AssignmentInput {
  sessionId: string;
  canWrite: boolean;
}

export interface SessionAssignmentListItem {
  sessionId: string;
  sessionTitle: string | null;
  sessionStatus: string;
  sessionCreatedAt: string;
  ownerName: string;
  ownerId: string;
  canWrite: boolean;
}

export interface ReportSummaryAssignment {
  id: string;
  reportSummaryId: string;
  userId: string;
  canWrite: boolean;
  assignedBy: string;
  assignedAt: string;
}

export interface ReportSummaryForAssignment {
  id: string;
  title: string | null;
  ownerName: string;
  ownerId: string;
  createdAt: string;
  isAssigned: boolean;
  canWrite: boolean;
}

export interface ReportSummaryAssignmentInput {
  reportSummaryId: string;
  canWrite: boolean;
}

export interface ReportSummaryAssignmentListItem {
  reportSummaryId: string;
  reportSummaryTitle: string | null;
  reportSummaryCreatedAt: string;
  ownerName: string;
  ownerId: string;
  canWrite: boolean;
}
