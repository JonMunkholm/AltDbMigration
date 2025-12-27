// Search - Table and column search functionality

import { State } from './state';
import { Utils } from './utils';
import { events } from './events';

// Track event subscription state
let eventsInitialized = false;

export const Search = {
  setup(): void {
    // Prevent duplicate event listeners
    if (eventsInitialized) return;
    eventsInitialized = true;

    const searchInput = document.getElementById('search') as HTMLInputElement | null;
    const clearBtn = document.getElementById('search-clear');

    if (!searchInput || !clearBtn) return;

    searchInput.addEventListener('input', () => this.update());

    clearBtn.addEventListener('click', () => {
      this.clear();
      searchInput.focus();
    });

    searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.clear();
        searchInput.blur();
      }
    });
  },

  update(): void {
    const searchInput = document.getElementById('search') as HTMLInputElement | null;
    const searchContainer = document.getElementById('search-container');
    if (!searchInput || !searchContainer) return;

    const query = searchInput.value.toLowerCase().trim();

    searchContainer.classList.toggle('has-value', !!searchInput.value);

    const tables = State.getTables();
    const matchingTables = Utils.filterTablesByQuery(tables, query);

    if (State.getView() === 'list') {
      events.emit('list:render');
    }

    if (!query) {
      events.emit('search:clear');
      Utils.updateStats(tables.length, tables.length);
      return;
    }

    const matchingIds = new Set(matchingTables.map(t => t.name));
    events.emit('search:highlight', matchingIds);
    Utils.updateStats(matchingTables.length, tables.length);
  },

  clear(): void {
    const searchInput = document.getElementById('search') as HTMLInputElement | null;
    const searchContainer = document.getElementById('search-container');

    if (!searchInput || !searchContainer) return;

    searchInput.value = '';
    searchContainer.classList.remove('has-value');
    events.emit('search:clear');
    Utils.updateStats(State.getTables().length, State.getTables().length);

    if (State.getView() === 'list') {
      events.emit('list:render');
    }
  },

  focus(): void {
    const searchInput = document.getElementById('search') as HTMLInputElement | null;
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  },

  getQuery(): string {
    const searchInput = document.getElementById('search') as HTMLInputElement | null;
    return searchInput?.value.toLowerCase().trim() || '';
  },
};
