// Main Application - Entry point and initialization

import { Api } from './api';
import { State } from './state';
import { Utils, getErrorMessage } from './utils';
import { Graph } from './graph';
import { ListView } from './list';
import { Details } from './details';
import { Search } from './search';
import { Modals } from './modals/index';
import { events } from './events';
import type { ViewMode } from './types';

// Event listener helpers
function onClick(id: string, handler: () => void): void {
  document.getElementById(id)?.addEventListener('click', handler);
}

function onChange(id: string, handler: () => void): void {
  document.getElementById(id)?.addEventListener('change', handler);
}

function onOverlayClick(id: string, handler: () => void): void {
  document.getElementById(id)?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      handler();
    }
  });
}

function setupButtonGroup(
  buttons: { id: string; action: () => void }[],
  activeClass = 'active'
): void {
  buttons.forEach(({ id, action }) => {
    document.getElementById(id)?.addEventListener('click', () => {
      buttons.forEach(b => document.getElementById(b.id)?.classList.remove(activeClass));
      document.getElementById(id)?.classList.add(activeClass);
      action();
    });
  });
}

// Subscribe to schema reload events from modals
events.on('schema:loaded', () => {
  App.loadSchema().then(() => {
    if (State.getView() === 'list') {
      ListView.render();
    }
  }).catch((error) => {
    Utils.toast.warning('Failed to refresh schema: ' + getErrorMessage(error));
  });
});

export const App = {
  async init(): Promise<void> {
    // Initialize API (fetch CSRF token)
    await Api.init();

    // Initialize modules that need DOM event listeners
    ListView.init();
    Details.init();

    await this.loadDatabases();
    await this.loadSchema();
    this.setupEventListeners();
    this.setupZoomControls();
    this.setupKeyboardShortcuts();
    this.setupModalHandlers();
  },

  setupEventListeners(): void {
    // Database select
    const dbSelect = document.getElementById('db-select') as HTMLSelectElement | null;
    dbSelect?.addEventListener('change', () => this.switchDatabase(dbSelect.value));

    // Button groups with active state
    setupButtonGroup([
      { id: 'view-graph', action: () => this.setView('graph') },
      { id: 'view-list', action: () => this.setView('list') },
    ]);

    setupButtonGroup([
      { id: 'layout-dagre', action: () => Graph.setLayout('dagre') },
      { id: 'layout-cose', action: () => Graph.setLayout('cose-bilkent') },
    ]);

    // Simple click handlers
    onClick('refresh-btn', () => this.refreshSchema());
    onClick('close-create-table', Modals.hideCreateTable);
    onClick('cancel-create-table', Modals.hideCreateTable);
    onClick('create-table-btn', Modals.createTable);
    onClick('close-add-column', Modals.hideAddColumn);
    onClick('cancel-add-column', Modals.hideAddColumn);
    onClick('add-column-btn', Modals.addColumn);

    // FK handlers
    onChange('new-column-fk', Modals.toggleForeignKeySection);
    onChange('fk-table', Modals.loadForeignKeyColumns);

    // Modal overlay clicks
    onOverlayClick('create-table-modal', Modals.hideCreateTable);
    onOverlayClick('add-column-modal', Modals.hideAddColumn);
  },

  async loadDatabases(): Promise<void> {
    try {
      const data = await Api.getDatabases();
      const select = document.getElementById('db-select') as HTMLSelectElement | null;
      if (!select) return;

      select.innerHTML = '';

      (data.databases || []).forEach(db => {
        const option = document.createElement('option');
        option.value = db;
        option.textContent = db;
        if (db === data.current) option.selected = true;
        select.appendChild(option);
      });
    } catch (error) {
      console.error('Failed to load databases:', error);
    }
  },

  async switchDatabase(dbName: string): Promise<void> {
    const select = document.getElementById('db-select') as HTMLSelectElement | null;
    if (!select) return;

    select.disabled = true;

    try {
      await Api.switchDatabase(dbName);
      // Clear expanded tables when switching databases
      State.clearExpandedTables();
      await this.loadSchema();
    } catch (error) {
      Utils.toast.error('Failed to switch database: ' + getErrorMessage(error));
      await this.loadDatabases();
    } finally {
      select.disabled = false;
    }
  },

  async refreshSchema(): Promise<void> {
    const btn = document.getElementById('refresh-btn') as HTMLButtonElement | null;
    if (!btn) return;

    btn.classList.add('loading');
    btn.disabled = true;

    try {
      await this.loadSchema();
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  },

  async loadSchema(): Promise<void> {
    try {
      const data = await Api.getSchema();
      State.setSchema(data);
      Utils.updateStats(State.getTables().length, State.getTables().length);

      const cyContainer = document.getElementById('cy');

      if (State.getTables().length === 0) {
        if (cyContainer) {
          cyContainer.innerHTML = '<div class="loading">No tables found in public schema</div>';
        }
        if (State.getView() === 'list') {
          ListView.render();
        }
        return;
      }

      Graph.init();
      Search.setup();

      // Re-render list view if currently active
      if (State.getView() === 'list') {
        ListView.render();
      }
    } catch (error) {
      const cyContainer = document.getElementById('cy');
      if (cyContainer) {
        cyContainer.innerHTML =
          '<div class="error">Error: ' + Utils.escapeHtml(getErrorMessage(error)) + '</div>';
      }
    }
  },

  setView(view: ViewMode): void {
    State.setView(view);

    document.getElementById('view-graph')?.classList.toggle('active', view === 'graph');
    document.getElementById('view-list')?.classList.toggle('active', view === 'list');

    const cyEl = document.getElementById('cy');
    const listEl = document.getElementById('list-view');
    const legendEl = document.querySelector('.legend') as HTMLElement | null;
    const zoomEl = document.querySelector('.zoom-controls') as HTMLElement | null;
    const noRelEl = document.getElementById('no-relationships');
    const detailsEl = document.getElementById('details');

    if (cyEl) cyEl.style.display = view === 'graph' ? 'block' : 'none';
    if (listEl) listEl.style.display = view === 'list' ? 'block' : 'none';
    if (legendEl) legendEl.style.display = view === 'graph' ? 'block' : 'none';
    if (zoomEl) zoomEl.style.display = view === 'graph' ? 'flex' : 'none';
    if (noRelEl) noRelEl.style.display = 'none';

    if (view === 'list') {
      if (detailsEl) detailsEl.style.display = 'none';
      ListView.render();
    } else {
      if (detailsEl) detailsEl.style.display = 'flex';
    }
  },

  setupZoomControls(): void {
    document.getElementById('zoom-in')?.addEventListener('click', () => Graph.zoomIn());
    document.getElementById('zoom-out')?.addEventListener('click', () => Graph.zoomOut());
    document.getElementById('zoom-fit')?.addEventListener('click', () => Graph.fitToView());
  },

  setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement;
      const isTyping =
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        activeEl?.tagName === 'SELECT';

      if (e.key === '/' && !isTyping) {
        e.preventDefault();
        e.stopPropagation();
        Search.focus();
        return;
      }

      if (isTyping) return;

      if (e.key === 'Escape' && State.getSelectedTable()) {
        Details.close();
      }

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        this.refreshSchema();
      }

      const cy = State.getCy();
      if (cy) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          cy.animate({ zoom: cy.zoom() * 1.2 }, { duration: 150 });
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          cy.animate({ zoom: cy.zoom() / 1.2 }, { duration: 150 });
        }
        if (e.key === '0') {
          e.preventDefault();
          Graph.fitToView();
        }
      }
    });
  },

  setupModalHandlers(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const createModal = document.getElementById('create-table-modal');
        const addModal = document.getElementById('add-column-modal');

        if (createModal?.classList.contains('active')) {
          e.preventDefault();
          Modals.createTable();
        } else if (addModal?.classList.contains('active')) {
          e.preventDefault();
          Modals.addColumn();
        }
      }

      if (e.key === 'Escape') {
        Modals.hideCreateTable();
        Modals.hideAddColumn();
      }
    });
  },
};

// Initialize on load
App.init();
