// List View - Table accordion rendering

import { State } from './state';
import { Utils } from './utils';
import { Search } from './search';
import { events } from './events';
import { Modals } from './modals/index';
import type { ForeignKey } from './types';

export const ListView = {
  init(): void {
    events.once('list:render', () => ListView.render(), 'list:render');

    const container = document.getElementById('list-view');
    if (container) {
      container.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const actionEl = target.closest('[data-action]') as HTMLElement | null;
        if (!actionEl) return;

        const action = actionEl.dataset.action;
        const tableName = actionEl.dataset.tableName;

        if (action === 'create-table') {
          Modals.showCreateTable();
        } else if (action === 'add-column' && tableName) {
          e.stopPropagation();
          Modals.showAddColumn(tableName);
        } else if (action === 'toggle' && tableName) {
          if (target.closest('[data-action="add-column"]')) return;
          this.toggle(tableName);
        } else if (action === 'expand-all') {
          this.expandAll();
        } else if (action === 'collapse-all') {
          this.collapseAll();
        }
      });
    }
  },

  render(): void {

    const schemaData = State.getSchema();
    if (!schemaData || !schemaData.tables) return;

    const container = document.getElementById('list-view');
    if (!container) return;

    const searchQuery = Search.getQuery();
    const fkLookup = Utils.buildFkLookup(schemaData.tables);

    const tables = Utils.filterTablesByQuery(schemaData.tables, searchQuery);

    let html = `
      <div class="list-header">
        <span class="list-title">${tables.length} table${tables.length !== 1 ? 's' : ''}</span>
        <div class="list-actions">
          <button class="list-action-btn" data-action="expand-all" title="Expand all">&#8862;</button>
          <button class="list-action-btn" data-action="collapse-all" title="Collapse all">&#8863;</button>
          <button class="new-table-btn" data-action="create-table">
            <span>+</span> New Table
          </button>
        </div>
      </div>
    `;

    tables.forEach(table => {
      const isExpanded = State.isTableExpanded(table.name);
      const columnCount = (table.columns || []).length;
      const escapedName = Utils.escapeHtml(table.name);

      html += `
        <div class="accordion-table ${isExpanded ? 'expanded' : ''}" data-table="${escapedName}">
          <div class="accordion-header" data-action="toggle" data-table-name="${escapedName}">
            <span class="accordion-icon">&#9658;</span>
            <span class="accordion-title">${escapedName}</span>
            <span class="accordion-meta">${columnCount} column${columnCount !== 1 ? 's' : ''}</span>
            <button class="add-column-btn" data-action="add-column" data-table-name="${escapedName}" title="Add column">+</button>
          </div>
          <div class="accordion-content">
      `;

      (table.columns || []).forEach(col => {
        const fkKey = `${table.name}.${col.name}`;
        const fk: ForeignKey | undefined = fkLookup[fkKey];

        let iconClass = '';
        let icon = '';
        if (col.isPrimary) {
          iconClass = 'pk';
          icon = '&#128273;';
        } else if (fk) {
          iconClass = 'fk';
          icon = '&#128279;';
        }

        html += `
          <div class="column-row">
            <span class="column-icon ${iconClass}">${icon}</span>
            <span class="column-name">${Utils.escapeHtml(col.name)}</span>
            <span class="column-type">${Utils.escapeHtml(col.dataType)}</span>
            <span class="column-badges">
              ${col.isPrimary ? '<span class="column-badge pk">PK</span>' : ''}
              ${fk ? '<span class="column-badge fk">FK</span>' : ''}
              ${col.isNullable ? '<span class="column-badge null">NULL</span>' : ''}
            </span>
            ${fk ? `<span class="fk-reference">&#8594; ${Utils.escapeHtml(fk.referencesTable)}.${Utils.escapeHtml(fk.referencesColumn)}</span>` : ''}
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    if (tables.length === 0 && searchQuery) {
      html += '<div class="loading">No tables match your search</div>';
    } else if (schemaData.tables.length === 0) {
      html += '<div class="loading">No tables in this database. Click "New Table" to create one.</div>';
    }

    container.innerHTML = html;
  },

  toggle(tableName: string): void {
    const isNowExpanded = State.toggleTableExpanded(tableName);

    document.querySelectorAll('.accordion-table.expanded').forEach(el => {
      el.classList.remove('expanded');
    });

    if (isNowExpanded) {
      const tableEl = document.querySelector(`.accordion-table[data-table="${tableName}"]`);
      if (tableEl) {
        tableEl.classList.add('expanded');
      }
    }
  },

  expandAll(): void {
    State.expandAllTables();
    document.querySelectorAll('.accordion-table').forEach(el => {
      el.classList.add('expanded');
    });
  },

  collapseAll(): void {
    State.collapseAllTables();
    document.querySelectorAll('.accordion-table').forEach(el => {
      el.classList.remove('expanded');
    });
  },
};
