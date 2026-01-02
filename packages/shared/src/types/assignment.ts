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
