export type User = {
  id: string;
  name: string;
  email?: string;
  role: "athlete" | "operator";
  boxId: string | null;
};
export type Box = {
  id: string;
  name: string;
  address: string;
  dong: string;
  district: string;
  lat: number;
  lng: number;
  description: string;
  ownerId: string;
  members: string[];
  checks: { userId: string; at: string }[];
  operatorVerified: boolean;
  active: boolean;
  decoration: boolean;
};
export type Template = {
  id: string;
  name: string;
  version: number;
  kind: "for-time" | "amrap";
  description: string;
  movements: string[];
  timeCap: number;
  totalReps: number;
  level: string;
};
export type RecordEntry = {
  userId: string;
  completed: boolean;
  seconds: number;
  reps: number;
  noReps: number;
  note: string;
  videoSecond: number;
};
export type Match = {
  id: string;
  title: string;
  defenderId: string;
  challengerId: string | null;
  template: Template;
  format: "individual" | "team3";
  level: string;
  venue: "together" | "separate";
  location: string;
  scheduledAt: string;
  submitBy: string;
  reviewBy: string;
  status: string;
  rosters: Record<string, string[]>;
  agreements: string[];
  acceptedAt?: string;
  submissions: Record<
    string,
    { records: RecordEntry[]; videoId: string; submittedAt: string }
  >;
  submissionBoxes?: string[];
  reviews: string[];
  dispute?: { reason: string; by: string };
  result?: { winnerId: string | null; reason: string };
  history: {
    at: string;
    action?: string;
    type?: string;
    reason?: string;
    [key: string]: unknown;
  }[];
  createdAt: string;
};
export type Ledger = {
  id: string;
  boxId: string;
  matchId?: string;
  kind: "rating" | "points";
  amount: number;
  balance: number;
  reason: string;
  at: string;
  format?: string;
  level?: string;
};
export type Snapshot = {
  user: User;
  users: User[];
  boxes: Box[];
  templates: Template[];
  matches: Match[];
  ledger: Ledger[];
  notifications: {
    id: string;
    title: string;
    body: string;
    matchId?: string;
  }[];
  joinRequests: { id: string; userId: string; boxId: string; status: string }[];
  policy: Record<string, unknown>;
  updatedAt: string;
  metrics: Record<string, number> | null;
};
export type Ranking = {
  boxId: string;
  name: string;
  rating: number;
  games: number;
  rank: number;
  provisional: boolean;
  dong: string;
  district: string;
};
