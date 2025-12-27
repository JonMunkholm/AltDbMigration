// Add Column Modal

import { State } from '../state';
import { Utils, getErrorMessage } from '../utils';
import { Api } from '../api';
import { events } from '../events';
import { ensureTypesLoaded, populateTypeDropdown, getElement } from './shared';
import type { AddColumnRequest } from '../types';

// Add column form elements interface
interface AddColumnFormElements {
  tableNameEl: HTMLElement;
  nameInput: HTMLInputElement;
  typeSelect: HTMLSelectElement;
  nullableCheck: HTMLInputElement;
  pkCheck: HTMLInputElement;
  uniqueCheck: HTMLInputElement;
  fkCheck: HTMLInputElement;
  fkSection: HTMLElement;
  fkTableSelect: HTMLSelectElement;
  fkColumnSelect: HTMLSelectElement;
  modal: HTMLElement;
  btn: HTMLButtonElement;
}

// Get all add column form elements, returns null if any are missing
function getFormElements(): AddColumnFormElements | null {
  const elements = {
    tableNameEl: getElement<HTMLElement>('add-column-table-name'),
    nameInput: getElement<HTMLInputElement>('new-column-name'),
    typeSelect: getElement<HTMLSelectElement>('new-column-type'),
    nullableCheck: getElement<HTMLInputElement>('new-column-nullable'),
    pkCheck: getElement<HTMLInputElement>('new-column-pk'),
    uniqueCheck: getElement<HTMLInputElement>('new-column-unique'),
    fkCheck: getElement<HTMLInputElement>('new-column-fk'),
    fkSection: getElement<HTMLElement>('fk-section'),
    fkTableSelect: getElement<HTMLSelectElement>('fk-table'),
    fkColumnSelect: getElement<HTMLSelectElement>('fk-column'),
    modal: getElement<HTMLElement>('add-column-modal'),
    btn: getElement<HTMLButtonElement>('add-column-btn'),
  };

  // Check all elements exist
  const allExist = Object.values(elements).every((el) => el !== null);
  return allExist ? (elements as AddColumnFormElements) : null;
}

export const AddColumnModal = {
  async show(tableName: string): Promise<void> {
    State.setModalTable(tableName);

    const form = getFormElements();
    if (!form) return;

    form.tableNameEl.textContent = tableName;

    // Populate type dropdown from backend
    const types = await ensureTypesLoaded();
    populateTypeDropdown(form.typeSelect, types);

    // Reset form
    form.nameInput.value = '';
    form.nullableCheck.checked = false;
    form.pkCheck.checked = false;
    form.uniqueCheck.checked = false;
    form.fkCheck.checked = false;
    form.fkSection.classList.add('disabled');

    // Populate FK table dropdown
    form.fkTableSelect.innerHTML = '<option value="">Select table...</option>';
    State.getTables().forEach((table) => {
      const option = document.createElement('option');
      option.value = table.name;
      option.textContent = table.name;
      form.fkTableSelect.appendChild(option);
    });

    form.fkColumnSelect.innerHTML = '<option value="">Select column...</option>';
    form.modal.classList.add('active');
    form.nameInput.focus();
  },

  hide(): void {
    const modal = document.getElementById('add-column-modal');
    if (modal) {
      modal.classList.remove('active');
    }
    State.setModalTable(null);
  },

  toggleForeignKeySection(): void {
    const fkCheck = document.getElementById('new-column-fk') as HTMLInputElement | null;
    const section = document.getElementById('fk-section');
    if (!fkCheck || !section) return;

    section.classList.toggle('disabled', !fkCheck.checked);
  },

  loadForeignKeyColumns(): void {
    const fkTableSelect = document.getElementById('fk-table') as HTMLSelectElement | null;
    const columnSelect = document.getElementById('fk-column') as HTMLSelectElement | null;
    if (!fkTableSelect || !columnSelect) return;

    const tableName = fkTableSelect.value;
    columnSelect.innerHTML = '<option value="">Select column...</option>';

    if (!tableName) return;

    const table = State.getTable(tableName);
    if (table && table.columns) {
      const refColumns = table.columns.filter(col => col.isPrimary || col.isUnique);
      refColumns.forEach((col, idx) => {
        const option = document.createElement('option');
        option.value = col.name;
        const badge = col.isPrimary ? 'PK' : 'UNIQUE';
        option.textContent = `${col.name} (${col.dataType}) [${badge}]`;
        if (idx === 0) option.selected = true;
        columnSelect.appendChild(option);
      });

      if (refColumns.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No PK or UNIQUE columns';
        option.disabled = true;
        columnSelect.appendChild(option);
      }
    }
  },

  async submit(): Promise<void> {
    const tableName = State.getModalTable();
    if (!tableName) return;

    const form = getFormElements();
    if (!form) return;

    const name = form.nameInput.value.trim();
    const type = form.typeSelect.value;
    const nullable = form.nullableCheck.checked;
    const primaryKey = form.pkCheck.checked;
    const unique = form.uniqueCheck.checked;
    const isForeignKey = form.fkCheck.checked;
    const fkTable = form.fkTableSelect.value;
    const fkColumn = form.fkColumnSelect.value;

    if (!name) {
      form.nameInput.focus();
      return;
    }

    if (!Utils.isValidIdentifier(name)) {
      Utils.toast.warning(
        'Column name must be lowercase, start with a letter or underscore, and contain only letters, numbers, and underscores.'
      );
      form.nameInput.focus();
      return;
    }

    if (isForeignKey && (!fkTable || !fkColumn)) {
      Utils.toast.warning('Please select a table and column for the foreign key reference.');
      return;
    }

    // Build confirmation message
    let confirmMsg = `Add column "${name}" (${type}) to "${tableName}"?`;
    const constraints: string[] = [];
    if (!nullable) constraints.push('NOT NULL');
    if (primaryKey) constraints.push('PRIMARY KEY');
    if (unique) constraints.push('UNIQUE');
    if (isForeignKey) constraints.push(`FK → ${fkTable}.${fkColumn}`);
    if (constraints.length > 0) {
      confirmMsg += `\n\nConstraints: ${constraints.join(', ')}`;
    }

    if (!confirm(confirmMsg)) {
      return;
    }

    form.btn.disabled = true;
    form.btn.textContent = 'Adding...';

    const payload: AddColumnRequest = { name, type, nullable, primaryKey, unique };
    if (isForeignKey && fkTable && fkColumn) {
      payload.foreignKey = { referencesTable: fkTable, referencesColumn: fkColumn };
    }

    try {
      await Api.addColumn(tableName, payload);
      this.hide();
      Utils.toast.success(`Column "${name}" added successfully`);

      // Notify that schema needs reloading
      events.emit('schema:loaded');
    } catch (error) {
      Utils.toast.error('Failed to add column: ' + getErrorMessage(error));
    } finally {
      form.btn.disabled = false;
      form.btn.textContent = 'Add Column';
    }
  },
};
