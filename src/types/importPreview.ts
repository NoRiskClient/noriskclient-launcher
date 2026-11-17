export interface RejectedMod {
  displayName: string;
  reason: string;
}

export interface ImportSecurityReport {
  strippedJavaPath: string | null;
  strippedJvmArgs: string | null;
  strippedGameArgs: string[];
  strippedQuickPlayPath: string | null;
  strippedLoaderVersion: string | null;
  rejectedMods: RejectedMod[];
  thirdPartyDownloadHosts: string[];
  unverifiedModCount: number;
  strippedProfileFlags: string[];
}

export type ImportPackType = "noriskpack" | "mrpack" | "curseforge";

export type UnknownContentReason =
  | "no_hash"
  | "not_on_platform"
  | "bundled_file"
  | "local_source";

export interface UnknownContent {
  name: string;
  reason: UnknownContentReason;
}

export interface ProvenanceReport {
  verifiedCount: number;
  unknown: UnknownContent[];
  incomplete: boolean;
}

export interface ExecutableContentReport {
  scripts: string[];
  natives: string[];
  scriptCount: number;
  nativeCount: number;
  truncated: boolean;
}

export interface NoriskPackOffer {
  packId: string;
  preselected: boolean;
}

export interface ImportPackPreview {
  filePath: string;
  fileName: string;
  fileSize: number;
  packType: ImportPackType;
  profileName: string | null;
  group: string | null;
  gameVersion: string | null;
  loader: string | null;
  loaderVersion: string | null;
  modCount: number;
  overrideFileCount: number;
  security: ImportSecurityReport;
  provenance: ProvenanceReport;
  noriskPack: NoriskPackOffer;
  executableContent: ExecutableContentReport;
}
