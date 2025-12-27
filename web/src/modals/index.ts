// Modals - Re-exports for Create Table and Add Column modals

export { CreateTableModal } from './createTable';
export { AddColumnModal } from './addColumn';

// Import for backward-compatible Modals object
import { CreateTableModal } from './createTable';
import { AddColumnModal } from './addColumn';

// Backward-compatible Modals object (matches original API)
export const Modals = {
  showCreateTable: () => CreateTableModal.show(),
  hideCreateTable: () => CreateTableModal.hide(),
  createTable: () => CreateTableModal.submit(),
  showAddColumn: (tableName: string) => AddColumnModal.show(tableName),
  hideAddColumn: () => AddColumnModal.hide(),
  toggleForeignKeySection: () => AddColumnModal.toggleForeignKeySection(),
  loadForeignKeyColumns: () => AddColumnModal.loadForeignKeyColumns(),
  addColumn: () => AddColumnModal.submit(),
};
