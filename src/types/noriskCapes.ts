// This file is auto-generated from the Rust sources. Do not edit manually.
// Corresponding Rust file: src-tauri/src/minecraft/api/cape_api.rs

// Define interfaces for cape data
export interface CosmeticCape {
  _id: string; // String in Rust, renamed from "_id" in JSON
  accepted: boolean; // bool in Rust
  uses: number; // i32 in Rust
  firstSeen: string; // Uuid in Rust, renamed from "firstSeen" in JSON
  moderatorMessage: string; // String in Rust, renamed from "moderatorMessage" in JSON
  creationDate: number; // i64 in Rust, renamed from "creationDate" in JSON
  elytra: boolean; // bool in Rust
  blurHash?: string; // Optional blur hash for the cape image
}

export type CapeReviewState = 'ACCEPTED' | 'IN_REVIEW' | 'DENIED';

export type OwnedCapesResponse = Record<CapeReviewState, CosmeticCape[]>;

export interface PaginationInfo {
  currentPage: number; // i32 in Rust, renamed from "currentPage" in JSON
  pageSize: number; // i32 in Rust, renamed from "pageSize" in JSON
  totalItems: number; // i32 in Rust, renamed from "totalItems" in JSON
  totalPages: number; // i32 in Rust, renamed from "totalPages" in JSON
}

export interface CapesBrowseResponse {
  capes: CosmeticCape[];
  pagination: PaginationInfo;
}

// Optional interface types for function parameters
export interface BrowseCapesOptions {
  page?: number;
  page_size?: number;
  sort_by?: string;
  filter_by_id?: string;
  filter_has_elytra?: boolean;
  filter_creator?: string;
  time_frame?: string;
  show_owned_only?: boolean;
  norisk_token?: string;
  request_uuid?: string;
}

export interface GetPlayerCapesPayloadOptions { 
  player_identifier: string; // snake_case
  norisk_token?: string;    // snake_case
  request_uuid?: string;    // snake_case
}