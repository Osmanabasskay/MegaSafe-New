export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';
export type PayoutOrder = 'sequential' | 'random';
export type GroupStatus = 'active' | 'completed' | 'pending';

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
  created_by: string; // user ID
  invite_code: string;
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
