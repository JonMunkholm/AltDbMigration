// Application State - Centralized state management

import type { Schema, Table, ViewMode, CytoscapeCore } from './types';

interface AppState {
  cy: CytoscapeCore | null;
  schemaData: Schema | null;
  selectedTable: string | null;
  currentView: ViewMode;
  expandedTables: Set<string>;
  currentModalTable: string | null;
}

const state: AppState = {
  cy: null,
  schemaData: null,
  selectedTable: null,
  currentView: 'graph',
  expandedTables: new Set(),
  currentModalTable: null,
};

export const State = {
  setSchema(data: Schema): void {
    state.schemaData = data;
    state.schemaData.tables = state.schemaData.tables || [];
  },

  getSchema(): Schema | null {
    return state.schemaData;
  },

  getTables(): Table[] {
    return state.schemaData?.tables || [];
  },

  getTable(name: string): Table | undefined {
    return this.getTables().find(t => t.name === name);
  },

  setView(view: ViewMode): void {
    state.currentView = view;
  },

  getView(): ViewMode {
    return state.currentView;
  },

  selectTable(name: string | null): void {
    state.selectedTable = name;
  },

  getSelectedTable(): string | null {
    return state.selectedTable;
  },

  toggleTableExpanded(name: string): boolean {
    const wasExpanded = state.expandedTables.has(name);
    state.expandedTables.clear();
    if (!wasExpanded) {
      state.expandedTables.add(name);
    }
    return !wasExpanded;
  },

  isTableExpanded(name: string): boolean {
    return state.expandedTables.has(name);
  },

  expandTable(name: string): void {
    state.expandedTables.add(name);
  },

  clearExpandedTables(): void {
    state.expandedTables.clear();
  },

  expandAllTables(): void {
    const tables = state.schemaData?.tables || [];
    tables.forEach(t => state.expandedTables.add(t.name));
  },

  collapseAllTables(): void {
    state.expandedTables.clear();
  },

  setCy(cy: CytoscapeCore): void {
    state.cy = cy;
  },

  getCy(): CytoscapeCore | null {
    return state.cy;
  },

  setModalTable(name: string | null): void {
    state.currentModalTable = name;
  },

  getModalTable(): string | null {
    return state.currentModalTable;
  },
};
