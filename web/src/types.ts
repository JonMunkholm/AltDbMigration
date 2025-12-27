// Schema Types - matches Go backend types

export interface ForeignKey {
  columnName: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface Column {
  name: string;
  dataType: string;
  isNullable: boolean;
  default: string | null;
  isPrimary: boolean;
  isUnique: boolean;
}

export interface Table {
  name: string;
  columns: Column[];
  foreignKeys: ForeignKey[];
}

export interface Schema {
  tables: Table[];
}

// API Response Types
export interface ApiError {
  code: string;
  message: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface DatabasesData {
  databases: string[];
  current: string;
}

export interface SwitchDatabaseData {
  database: string;
}

export interface CreateTableData {
  table: string;
}

export interface AddColumnData {
  column: string;
}

// Type information from backend
export interface TypeInfo {
  name: string;
  description: string;
  category: string;
}

export interface TypesData {
  types: TypeInfo[];
}

// Add Column Request
export interface AddColumnRequest {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  foreignKey?: {
    referencesTable: string;
    referencesColumn: string;
  };
}

// Toast Types
export type ToastType = 'success' | 'error' | 'warning' | 'info';

// View Types
export type ViewMode = 'graph' | 'list';

// Cytoscape Types (augment as needed)
import type { Core as CytoscapeCore } from 'cytoscape';
export type { CytoscapeCore };
