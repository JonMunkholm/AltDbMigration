// Details Panel - Table and relationship details

import { State } from './state';
import { Utils } from './utils';
import { events } from './events';
import type { ForeignKey } from './types';

export const Details = {
  init(): void {
    const container = document.getElementById('details');
    if (container) {
      container.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        if (target.closest('[data-action="close"]')) {
          this.close();
          return;
        }

        const navEl = target.closest('[data-navigate]') as HTMLElement | null;
        if (navEl) {
          const tableName = navEl.dataset.navigate;
          if (tableName) {
            events.emit('table:navigate', tableName);
          }
        }
      });
    }
  },

  showTable(tableName: string): void {
    const table = State.getTable(tableName);
    if (!table) return;

    State.selectTable(tableName);
    const details = document.getElementById('details');
    if (!details) return;

    const fkColumns = new Set((table.foreignKeys || []).map(fk => fk.columnName));
    const fkDetails: Record<string, ForeignKey> = {};
    (table.foreignKeys || []).forEach(fk => {
      fkDetails[fk.columnName] = fk;
    });

    let html = `
      <div class="details-header">
        <h2>${Utils.escapeHtml(table.name)}</h2>
        <button class="close-btn" data-action="close">&times;</button>
      </div>
      <div class="details-content">
        <div class="section-title">Columns (${(table.columns || []).length})</div>
        <ul class="column-list">
    `;

    (table.columns || []).forEach(col => {
      const isPrimary = col.isPrimary;
      const isFK = fkColumns.has(col.name);
      const classes = [isPrimary ? 'primary' : '', isFK ? 'fk' : ''].filter(Boolean).join(' ');

      html += `<li class="column-item ${classes}">`;
      html += `<div class="column-name">${Utils.escapeHtml(col.name)}</div>`;
      html += `<div class="column-type">${Utils.escapeHtml(col.dataType)}</div>`;
      html += '<div class="column-badges">';
      if (isPrimary) html += '<span class="badge pk">PK</span>';
      if (isFK) html += '<span class="badge fk">FK</span>';
      if (col.isNullable) html += '<span class="badge nullable">null</span>';
      if (col.default) html += `<span class="badge default" title="Default: ${Utils.escapeHtml(col.default)}">def</span>`;
      html += '</div>';

      if (isFK) {
        const fk = fkDetails[col.name];
        html += `<div class="fk-ref" data-navigate="${Utils.escapeHtml(fk.referencesTable)}">→ ${Utils.escapeHtml(fk.referencesTable)}.${Utils.escapeHtml(fk.referencesColumn)}</div>`;
      }
      html += '</li>';
    });

    html += '</ul></div>';
    details.innerHTML = html;
  },

  showRelationship(fromTable: string, fromColumn: string, toTable: string, toColumn: string): void {
    State.selectTable(null);
    const details = document.getElementById('details');
    if (!details) return;

    details.innerHTML = `
      <div class="details-header">
        <h2>Relationship</h2>
        <button class="close-btn" data-action="close">&times;</button>
      </div>
      <div class="relationship-details">
        <h3>Foreign Key</h3>
        <div class="relationship-card">
          <div class="from">
            <span class="table-name">${Utils.escapeHtml(fromTable)}</span>.<span class="column-name">${Utils.escapeHtml(fromColumn)}</span>
          </div>
          <div class="arrow">&#8595;</div>
          <div class="to">
            <span class="table-name">${Utils.escapeHtml(toTable)}</span>.<span class="column-name">${Utils.escapeHtml(toColumn)}</span>
          </div>
        </div>
      </div>
      <div class="details-content">
        <div class="section-title">Navigate</div>
        <ul class="column-list">
          <li class="column-item nav-item" data-navigate="${Utils.escapeHtml(fromTable)}" style="cursor:pointer">
            <div class="column-name">${Utils.escapeHtml(fromTable)}</div>
            <div class="column-type">Source table</div>
          </li>
          <li class="column-item nav-item" data-navigate="${Utils.escapeHtml(toTable)}" style="cursor:pointer">
            <div class="column-name">${Utils.escapeHtml(toTable)}</div>
            <div class="column-type">Referenced table</div>
          </li>
        </ul>
      </div>
    `;
  },

  close(): void {
    State.selectTable(null);
    events.emit('search:clear');
    const cy = State.getCy();
    if (cy) cy.elements().unselect();
    const details = document.getElementById('details');
    if (details) {
      details.innerHTML = '<div class="details-empty">Click a table to view details</div>';
    }
  },
};
