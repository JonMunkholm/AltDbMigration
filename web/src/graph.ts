// Graph View - Cytoscape visualization

import cytoscape from 'cytoscape';
import cytoscapeDagre from 'cytoscape-dagre';
import cytoscapeCoseBilkent from 'cytoscape-cose-bilkent';
import type { Core, EdgeSingular, StylesheetStyle } from 'cytoscape';
import { State } from './state';
import { Details } from './details';
import { events } from './events';

// Register layout extensions
cytoscape.use(cytoscapeDagre);
cytoscape.use(cytoscapeCoseBilkent);

// Layout types and configurations
export type LayoutType = 'dagre' | 'cose-bilkent';
let currentLayout: LayoutType = 'dagre';

const layouts: Record<LayoutType, cytoscape.LayoutOptions> = {
  dagre: {
    name: 'dagre',
    rankDir: 'LR',
    nodeSep: 100,
    rankSep: 150,
    edgeSep: 30,
    ranker: 'tight-tree',
    padding: 50,
  } as cytoscape.LayoutOptions,
  'cose-bilkent': {
    name: 'cose-bilkent',
    quality: 'default',
    nodeRepulsion: 4500,
    idealEdgeLength: 150,
    edgeElasticity: 0.45,
    nestingFactor: 0.1,
    gravity: 0.25,
    numIter: 2500,
    tile: true,
    animate: false,
    padding: 50,
  } as cytoscape.LayoutOptions,
};

// Cytoscape element data types
interface NodeData {
  id: string;
  label: string;
  tableName: string;
  incoming: number;
  outgoing: number;
}

interface EdgeData {
  id: string;
  source: string;
  target: string;
  sourceColumn: string;
  targetColumn: string;
  label: string;
}

type ElementDefinition = { data: NodeData } | { data: EdgeData };

export const Graph = {
  init(): void {
    // Subscribe to events (once per unique key)
    events.once('table:navigate', (tableName) => Graph.navigateToTable(tableName), 'graph:navigate');
    events.once('search:clear', () => Graph.clearHighlights(), 'graph:clear');
    events.once('search:highlight', (ids) => Graph.highlightMatches(ids), 'graph:highlight');

    const tables = State.getTables();
    const elements: ElementDefinition[] = [];

    // Pre-calculate incoming relationships for each table
    const incomingRefs: Record<string, number> = {};
    tables.forEach(table => {
      (table.foreignKeys || []).forEach(fk => {
        incomingRefs[fk.referencesTable] = (incomingRefs[fk.referencesTable] || 0) + 1;
      });
    });

    // Create nodes for each table
    tables.forEach(table => {
      const outgoing = (table.foreignKeys || []).length;
      const incoming = incomingRefs[table.name] || 0;

      const columns = (table.columns || []).slice(0, 8).map(col => {
        const pk = col.isPrimary ? '🔑 ' : '   ';
        const fk = (table.foreignKeys || []).some(f => f.columnName === col.name) ? '🔗 ' : '   ';
        const prefix = col.isPrimary ? pk : fk;
        return `${prefix}${col.name}`;
      });

      if ((table.columns || []).length > 8) {
        columns.push(`   ... +${table.columns.length - 8} more`);
      }

      let header = table.name;
      const badges: string[] = [];
      if (incoming > 0) badges.push(`← ${incoming}`);
      if (outgoing > 0) badges.push(`→ ${outgoing}`);
      if (badges.length > 0) {
        header += `  [${badges.join(' ')}]`;
      }

      const label = `${header}\n${'─'.repeat(Math.max(header.length, 20))}\n${columns.join('\n')}`;

      elements.push({
        data: {
          id: table.name,
          label: label,
          tableName: table.name,
          incoming: incoming,
          outgoing: outgoing,
        },
      });
    });

    // Create edges for foreign keys
    let relationshipCount = 0;
    tables.forEach(table => {
      (table.foreignKeys || []).forEach(fk => {
        relationshipCount++;
        elements.push({
          data: {
            id: `${table.name}-${fk.columnName}-${fk.referencesTable}`,
            source: table.name,
            target: fk.referencesTable,
            sourceColumn: fk.columnName,
            targetColumn: fk.referencesColumn,
            label: `${table.name}.${fk.columnName} → ${fk.referencesTable}.${fk.referencesColumn}`,
          },
        });
      });
    });

    // Show/hide no relationships notice
    const noRelEl = document.getElementById('no-relationships');
    if (noRelEl) {
      noRelEl.style.display = relationshipCount === 0 ? 'block' : 'none';
    }

    const cyContainer = document.getElementById('cy');
    if (!cyContainer) return;
    cyContainer.innerHTML = '';

    try {
      const cy = cytoscape({
        container: cyContainer,
        elements: elements as cytoscape.ElementDefinition[],
        minZoom: 0.2,
        maxZoom: 3,
        wheelSensitivity: 0.3,
        style: this.getStyles(),
        layout: layouts[currentLayout],
      });

      State.setCy(cy);
      this.setupEventHandlers(cy);
      this.updateZoomLevel();
    } catch (e) {
      console.error('Failed to initialize Cytoscape:', e);
    }
  },

  getStyles(): StylesheetStyle[] {
    return [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'background-color': '#0f3460',
          color: '#fff',
          'font-size': '11px',
          'font-family': 'Monaco, Consolas, monospace',
          width: 'label',
          height: 'label',
          padding: '16px',
          shape: 'round-rectangle',
          'border-width': '2px',
          'border-color': '#3498db',
          'text-wrap': 'wrap',
          'text-max-width': '200px',
        } as cytoscape.Css.Node,
      },
      {
        selector: 'node:selected',
        style: { 'border-color': '#e94560', 'border-width': '3px' } as cytoscape.Css.Node,
      },
      {
        selector: 'node.highlighted',
        style: {
          'border-color': '#e94560',
          'border-width': '3px',
          'background-color': '#1a3a5c',
        } as cytoscape.Css.Node,
      },
      {
        selector: 'node.dimmed',
        style: { opacity: 0.3 } as cytoscape.Css.Node,
      },
      {
        selector: 'edge',
        style: {
          width: 2,
          'line-color': '#3498db',
          'target-arrow-color': '#3498db',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          opacity: 0.7,
        } as cytoscape.Css.Edge,
      },
      {
        selector: 'edge:selected',
        style: {
          'line-color': '#e94560',
          'target-arrow-color': '#e94560',
          opacity: 1,
          width: 3,
        } as cytoscape.Css.Edge,
      },
      {
        selector: 'edge.highlighted',
        style: {
          'line-color': '#e94560',
          'target-arrow-color': '#e94560',
          opacity: 1,
          width: 3,
        } as cytoscape.Css.Edge,
      },
      {
        selector: 'edge.dimmed',
        style: { opacity: 0.15 } as cytoscape.Css.Edge,
      },
      {
        selector: 'edge.hovered',
        style: {
          'label': 'data(label)',
          'text-background-color': '#0f3460',
          'text-background-opacity': 1,
          'text-background-padding': '6px',
          'text-background-shape': 'roundrectangle',
          'color': '#fff',
          'font-size': '11px',
          'font-family': 'Monaco, Consolas, monospace',
          'text-border-width': 1,
          'text-border-color': '#3498db',
          'text-border-opacity': 1,
          'width': 3,
          'line-color': '#e94560',
          'target-arrow-color': '#e94560',
        } as cytoscape.Css.Edge,
      },
    ];
  },

  setupEventHandlers(cy: Core): void {
    cy.on('zoom', () => this.updateZoomLevel());

    cy.on('tap', 'node', evt => {
      Details.showTable(evt.target.id());
      this.highlightConnections(evt.target.id());
    });

    cy.on('mouseover', 'node', () => {
      document.body.style.cursor = 'pointer';
    });
    cy.on('mouseout', 'node', () => {
      document.body.style.cursor = 'default';
    });

    cy.on('mouseover', 'edge', evt => {
      document.body.style.cursor = 'pointer';
      evt.target.addClass('hovered');
    });

    cy.on('mouseout', 'edge', evt => {
      document.body.style.cursor = 'default';
      evt.target.removeClass('hovered');
    });

    cy.on('tap', 'edge', evt => {
      const edge = evt.target;
      Details.showRelationship(
        edge.data('source'),
        edge.data('sourceColumn'),
        edge.data('target'),
        edge.data('targetColumn')
      );
      this.highlightRelationship(edge);
    });
  },

  highlightConnections(tableName: string): void {
    const cy = State.getCy();
    if (!cy) return;
    cy.elements().removeClass('highlighted dimmed');
    const node = cy.getElementById(tableName);
    const connectedEdges = node.connectedEdges();
    const connectedNodes = connectedEdges.connectedNodes();
    cy.elements().addClass('dimmed');
    node.removeClass('dimmed').addClass('highlighted');
    connectedEdges.removeClass('dimmed').addClass('highlighted');
    connectedNodes.removeClass('dimmed');
  },

  highlightRelationship(edge: EdgeSingular): void {
    const cy = State.getCy();
    if (!cy) return;
    cy.elements().removeClass('highlighted dimmed').addClass('dimmed');
    edge.removeClass('dimmed').addClass('highlighted');
    edge.source().removeClass('dimmed').addClass('highlighted');
    edge.target().removeClass('dimmed').addClass('highlighted');
  },

  clearHighlights(): void {
    const cy = State.getCy();
    if (cy) cy.elements().removeClass('highlighted dimmed');
  },

  highlightMatches(matchingIds: Set<string>): void {
    const cy = State.getCy();
    if (!cy) return;
    cy.nodes().forEach(node => {
      if (matchingIds.has(node.id())) {
        node.removeClass('dimmed').addClass('highlighted');
      } else {
        node.removeClass('highlighted').addClass('dimmed');
      }
    });
    cy.edges().addClass('dimmed');
  },

  navigateToTable(tableName: string): void {
    const cy = State.getCy();
    if (!cy) return;
    const node = cy.getElementById(tableName);
    if (node.length > 0) {
      cy.animate({ center: { eles: node }, zoom: 1.2 }, { duration: 300 });
      cy.elements().unselect();
      node.select();
      Details.showTable(tableName);
      this.highlightConnections(tableName);
    }
  },

  updateZoomLevel(): void {
    const cy = State.getCy();
    if (!cy) return;
    const zoom = Math.round(cy.zoom() * 100);
    const zoomEl = document.getElementById('zoom-level');
    if (zoomEl) {
      zoomEl.textContent = `${zoom}%`;
    }
  },

  fitToView(): void {
    const cy = State.getCy();
    if (!cy) return;
    cy.animate({ fit: { eles: cy.elements(), padding: 50 } }, { duration: 300 });
  },

  zoomIn(): void {
    const cy = State.getCy();
    if (!cy) return;
    cy.animate({ zoom: cy.zoom() * 1.2, center: { eles: cy.elements() } }, { duration: 200 });
  },

  zoomOut(): void {
    const cy = State.getCy();
    if (!cy) return;
    cy.animate({ zoom: cy.zoom() / 1.2, center: { eles: cy.elements() } }, { duration: 200 });
  },

  setLayout(type: LayoutType): void {
    currentLayout = type;
    const cy = State.getCy();
    if (cy) {
      cy.layout(layouts[type]).run();
    }
  },

  getLayout(): LayoutType {
    return currentLayout;
  },
};
