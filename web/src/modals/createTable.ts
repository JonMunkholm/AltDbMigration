// Create Table Modal

import { State } from '../state';
import { Utils, getErrorMessage } from '../utils';
import { Api } from '../api';
import { events } from '../events';

export const CreateTableModal = {
  show(): void {
    const nameInput = document.getElementById('new-table-name') as HTMLInputElement | null;
    const modal = document.getElementById('create-table-modal');
    if (!nameInput || !modal) return;

    nameInput.value = '';
    modal.classList.add('active');
    nameInput.focus();
  },

  hide(): void {
    const modal = document.getElementById('create-table-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  },

  async submit(): Promise<void> {
    const nameInput = document.getElementById('new-table-name') as HTMLInputElement | null;
    if (!nameInput) return;

    const name = nameInput.value.trim();

    if (!name) {
      nameInput.focus();
      return;
    }

    if (!Utils.isValidIdentifier(name)) {
      Utils.toast.warning(
        'Table name must be lowercase, start with a letter or underscore, and contain only letters, numbers, and underscores.'
      );
      nameInput.focus();
      return;
    }

    if (!confirm(`Create table "${name}" with primary key "id"?`)) {
      return;
    }

    const btn = document.getElementById('create-table-btn') as HTMLButtonElement | null;
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
      await Api.createTable(name);
      this.hide();
      Utils.toast.success(`Table "${name}" created successfully`);

      // Notify that schema needs reloading
      State.expandTable(name);
      events.emit('schema:loaded');
    } catch (error) {
      Utils.toast.error('Failed to create table: ' + getErrorMessage(error));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Table';
    }
  },
};
