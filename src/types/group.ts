export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';
export type PayoutOrder = 'sequential' | 'random' | 'custom';
export type GroupStatus = 'active' | 'paused' | 'completed' | 'disbanded' | 'pending';

export interface GroupInviteContact {
  name: string;
  email: string;
  phone: string;
}

export interface GroupConfiguration {
  adminCollectionPhone?: string | null;
  invites?: GroupInviteContact[];
  rules?: Record<string, unknown>;
  deletionRequest?: {
    requestedBy: string;
    requestedAt: string;
    reason: string;
    status: 'pending_super_admin';
  };
}

export interface OsusuGroup {
  id: string;
  created_at: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  contribution_amount: number;
  frequency: Frequency;
  max_members: number;
  cycle_start_date: string;
  total_cycles: number;
  payout_order: PayoutOrder;
  is_public: boolean;
  join_requires_approval: boolean;
  custom_rules: string | null;
  status: GroupStatus;
  created_by: string;
  invite_code: string;
  contribution_number: string | null;
}

export type JoinRequestStatus = 'pending' | 'approved' | 'rejected';

export interface JoinRequest {
  id: string;
  group_id: string;
  user_id: string;
  message: string | null;
  status: JoinRequestStatus;
  created_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  payout_position: number | null;
  joined_at: string;
}

/** A member assigned as a contributor (for collector dropdown). */
export interface ContributorAssignment {
  membershipId: string;
  userId: string;
  displayName: string;
  phone: string | null;
  payoutPosition: number | null;
}

/** Row from the collectors table. */
export interface CollectorRecord {
  id: string;
  groupId: string;
  profileId: string;
  addedBy: string;
  collectorType: 'staff' | 'member_collector';
  membershipId: string | null;
  dailyCollectionLimit: number | null;
  isActive: boolean;
  totalCollected: number;
  totalVerified: number;
  collectorPasscode: string | null;
  collectorDisplayName: string | null;
  collectorPhotoUrl: string | null;
  deactivatedAt: string | null;
}
