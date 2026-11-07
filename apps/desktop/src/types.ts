export type Engine = "paper" | "fabric";
export interface Component {
  id: string;
  engine: Engine;
  minecraft: string;
  version: string;
  javaMajor: number;
  sha256: string;
  bytes: number;
  installedAt: number;
  sourceUrl?: string | null;
}
export interface Player {
  uuid: string;
  name: string;
  operator?: boolean;
  operatorLevel?: number;
}
export interface World {
  id: string;
  name: string;
  revision: number;
  component: Component;
  memoryMb: number;
  maxPlayers: number;
  port: number;
  lan: boolean;
  onlineMode?: boolean;
  seed: string;
  difficulty: string;
  gamemode: string;
  hardcore?: boolean;
  pvp?: boolean;
  allowCommands?: boolean;
  forceGamemode?: boolean;
  coverBlock?: string | null;
  eulaAcceptedAt: number;
  players: Player[];
  createdAt: number;
  lastPlayed: number | null;
  packNotes: string;
}
export interface Backup {
  id: string;
  world: World;
  createdAt: number;
  bytes: number;
  sha256: string;
}
export interface Settings {
  defaultEngine: Engine;
  memoryMb: number;
  reducedMotion: boolean;
  glass?: boolean;
  stars?: boolean;
  starMotion?: "wander" | "float" | "still";
  starSpeed?: "slow" | "balanced" | "lively";
  starShimmer?: boolean;
  glassOpacity?: "clear" | "frosted" | "dense";
  starDensity?: "low" | "medium" | "high";
  motionSpeed?: "gentle" | "normal" | "lively";
  preventSleep: boolean;
}
export interface Operation {
  id: string;
  label: string;
  status: "queued" | "running" | "completed" | "failed";
  message: string;
  progress: number | null;
  startedAt: number;
  finishedAt: number | null;
}
export interface Session {
  worldId: string;
  state: string;
  startedAt: number;
  pid: number | null;
  memoryBytes: number;
  cpuPercent: number;
  players: string[];
  playersKnown?: boolean;
  error: string | null;
}
export interface Provider {
  linked: boolean;
  persisted: boolean;
  agentRegistered: boolean;
  state: string;
  endpoints: string[];
  error: string | null;
  claimUrl: string | null;
}
export interface Snapshot {
  worlds: World[];
  components: Component[];
  backups: Backup[];
  settings: Settings;
  session: Session | null;
  provider: Provider;
  operations: Operation[];
  logs: string[];
  dataDir: string;
  totalMemory: number;
  memory?: MemorySnapshot;
  providerSetup?: { tunnelConfigured: boolean; checkedAt: number | null };
  softwareUpdates?: SoftwareUpdate[];
  warnings: string[];
}
export interface Version {
  engine: Engine;
  minecraft: string;
  version: string;
  javaMajor: number;
  url: string;
  sha256: string | null;
  size: number | null;
}
export interface DeletePlan {
  token: string;
  worldId: string;
  revision: number;
  phrase: string;
  keepBackups: boolean;
  backupIds: string[];
  expiresAt: number;
}
export interface SoftwareUpdate {
  componentId: string;
  latest: string | null;
  status: "updateAvailable" | "upToDate" | "unavailable";
  checkedAt: number;
}
export interface MemorySnapshot {
  total: number;
  available: number;
  used: number;
  app: number;
  server: number;
  minecraftClients: number;
  clientCount: number;
  other: number;
  observedAt: number;
  partialProcessVisibility: boolean;
}
