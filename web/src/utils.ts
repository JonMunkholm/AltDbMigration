// Utility Functions

import type { Table, ForeignKey, ToastType } from './types';
import { ApiError } from './api';

type FkLookup = Record<string, ForeignKey>;

// Safely extract error message from unknown error type
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unexpected error occurred';
}

// Toast notification system
const toast = {
  container: null as HTMLDivElement | null,

  init(): void {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.id = 'toast-container';
    document.body.appendChild(this.container);
  },

  show(message: string, type: ToastType = 'info', duration: number = 4000): void {
    this.init();
    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;
    toastEl.innerHTML = `
      <span class="toast-message">${Utils.escapeHtml(message)}</span>
      <button class="toast-close">&times;</button>
    `;

    const closeBtn = toastEl.querySelector('.toast-close') as HTMLButtonElement;
    closeBtn.onclick = () => this.dismiss(toastEl);
    this.container!.appendChild(toastEl);

    // Trigger animation
    requestAnimationFrame(() => toastEl.classList.add('toast-visible'));

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => this.dismiss(toastEl), duration);
    }
  },

  dismiss(toastEl: HTMLElement): void {
    toastEl.classList.remove('toast-visible');
    toastEl.classList.add('toast-hiding');
    setTimeout(() => toastEl.remove(), 300);
  },

  success(message: string): void {
    this.show(message, 'success');
  },
  error(message: string): void {
    this.show(message, 'error', 6000);
  },
  warning(message: string): void {
    this.show(message, 'warning');
  },
  info(message: string): void {
    this.show(message, 'info');
  },
};

export const Utils = {
  // Filter tables by search query
  filterTablesByQuery(tables: Table[], query: string): Table[] {
    if (!query) return tables;
    const lowerQuery = query.toLowerCase();
    return tables.filter(table => {
      if (table.name.toLowerCase().includes(lowerQuery)) return true;
      return (table.columns || []).some(col =>
        col.name.toLowerCase().includes(lowerQuery)
      );
    });
  },

  // Build FK lookup map for quick access
  buildFkLookup(tables: Table[]): FkLookup {
    const lookup: FkLookup = {};
    tables.forEach(table => {
      (table.foreignKeys || []).forEach(fk => {
        lookup[`${table.name}.${fk.columnName}`] = fk;
      });
    });
    return lookup;
  },

  // Escape HTML to prevent XSS
  escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // Validate identifier (table/column name)
  // Must match backend validation: lowercase letters, numbers, underscores
  // Must start with letter or underscore, max 63 chars (PostgreSQL limit)
  isValidIdentifier(name: string): boolean {
    if (!name || name.length > 63) return false;
    return /^[a-z_][a-z0-9_]*$/.test(name);
  },

  // Update stats display
  updateStats(shown: number, total: number): void {
    const stats = document.getElementById('stats');
    if (!stats) return;
    if (shown === total) {
      stats.textContent = `${total} tables`;
    } else {
      stats.textContent = `${shown} of ${total} tables`;
    }
  },

  toast,
};
