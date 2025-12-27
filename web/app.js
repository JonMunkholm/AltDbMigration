// Schema Visualizer Application
// Main application state
let cy;
let schemaData;
let selectedTable = null;
let currentView = 'graph';
let expandedTables = new Set();

// ============================================================================
// View Management
// ============================================================================

function setView(view) {
    currentView = view;

    // Update toggle buttons
    document.getElementById('view-graph').classList.toggle('active', view === 'graph');
    document.getElementById('view-list').classList.toggle('active', view === 'list');

    // Toggle view containers
    document.getElementById('cy').style.display = view === 'graph' ? 'block' : 'none';
    document.getElementById('list-view').style.display = view === 'list' ? 'block' : 'none';

    // Toggle graph-specific elements
    document.querySelector('.legend').style.display = view === 'graph' ? 'block' : 'none';
    document.querySelector('.zoom-controls').style.display = view === 'graph' ? 'flex' : 'none';
    document.getElementById('no-relationships').style.display = 'none';

    // Hide details panel when switching to list view
    if (view === 'list') {
        document.getElementById('details').style.display = 'none';
        renderListView();
    } else {
        document.getElementById('details').style.display = 'flex';
    }
}

// ============================================================================
// List View
// ============================================================================

function renderListView() {
    if (!schemaData || !schemaData.tables) return;

    const container = document.getElementById('list-view');
    const searchQuery = document.getElementById('search').value.toLowerCase().trim();

    // Build FK lookup
    const fkLookup = {};
    schemaData.tables.forEach(table => {
        (table.foreignKeys || []).forEach(fk => {
            fkLookup[`${table.name}.${fk.columnName}`] = fk;
        });
    });

    // Filter tables if searching
    let tables = schemaData.tables;
    if (searchQuery) {
        tables = tables.filter(table => {
            if (table.name.toLowerCase().includes(searchQuery)) return true;
            return (table.columns || []).some(col =>
                col.name.toLowerCase().includes(searchQuery)
            );
        });
    }

    // List view header with "New Table" button
    let html = `
        <div class="list-header">
            <span class="list-title">${tables.length} table${tables.length !== 1 ? 's' : ''}</span>
            <button class="new-table-btn" onclick="showCreateTableModal()">
                <span>+</span> New Table
            </button>
        </div>
    `;

    tables.forEach(table => {
        const isExpanded = expandedTables.has(table.name);
        const columnCount = (table.columns || []).length;

        html += `
            <div class="accordion-table ${isExpanded ? 'expanded' : ''}" data-table="${table.name}">
                <div class="accordion-header">
                    <span class="accordion-icon" onclick="toggleTable('${table.name}')">&#9658;</span>
                    <span class="accordion-title" onclick="toggleTable('${table.name}')">${table.name}</span>
                    <span class="accordion-meta" onclick="toggleTable('${table.name}')">${columnCount} column${columnCount !== 1 ? 's' : ''}</span>
                    <button class="add-column-btn" onclick="event.stopPropagation(); showAddColumnModal('${table.name}')" title="Add column">+</button>
                </div>
                <div class="accordion-content">
        `;

        (table.columns || []).forEach(col => {
            const fkKey = `${table.name}.${col.name}`;
            const fk = fkLookup[fkKey];

            let iconClass = '';
            let icon = '';
            if (col.isPrimary) {
                iconClass = 'pk';
                icon = '&#128273;'; // key emoji
            } else if (fk) {
                iconClass = 'fk';
                icon = '&#128279;'; // link emoji
            }

            html += `
                <div class="column-row">
                    <span class="column-icon ${iconClass}">${icon}</span>
                    <span class="column-name">${col.name}</span>
                    <span class="column-type">${col.dataType}</span>
                    <span class="column-badges">
                        ${col.isPrimary ? '<span class="column-badge pk">PK</span>' : ''}
                        ${fk ? '<span class="column-badge fk">FK</span>' : ''}
                        ${col.isNullable ? '<span class="column-badge null">NULL</span>' : ''}
                    </span>
                    ${fk ? `<span class="fk-reference">&#8594; ${fk.referencesTable}.${fk.referencesColumn}</span>` : ''}
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
}

function toggleTable(tableName) {
    const isCurrentlyExpanded = expandedTables.has(tableName);

    // Collapse all tables first
    expandedTables.clear();
    document.querySelectorAll('.accordion-table.expanded').forEach(el => {
        el.classList.remove('expanded');
    });

    // If clicking on a collapsed table, expand it
    if (!isCurrentlyExpanded) {
        expandedTables.add(tableName);
        const tableEl = document.querySelector(`.accordion-table[data-table="${tableName}"]`);
        if (tableEl) {
            tableEl.classList.add('expanded');
        }
    }
}

// ============================================================================
// Database Operations
// ============================================================================

async function loadDatabases() {
    try {
        const response = await fetch('/api/databases');
        if (!response.ok) throw new Error('Failed to load databases');
        const data = await response.json();

        const select = document.getElementById('db-select');
        select.innerHTML = '';

        (data.databases || []).forEach(db => {
            const option = document.createElement('option');
            option.value = db;
            option.textContent = db;
            if (db === data.current) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Failed to load databases:', error);
    }
}

async function switchDatabase(dbName) {
    const select = document.getElementById('db-select');
    select.disabled = true;

    try {
        const response = await fetch('/api/database', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: dbName })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }

        await loadSchema();
    } catch (error) {
        alert('Failed to switch database: ' + error.message);
        await loadDatabases(); // Reset dropdown to current DB
    } finally {
        select.disabled = false;
    }
}

async function refreshSchema() {
    const btn = document.getElementById('refresh-btn');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
        await loadSchema();
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

async function loadSchema() {
    try {
        const response = await fetch('/api/schema');
        if (!response.ok) throw new Error('Failed to load schema');
        schemaData = await response.json();
        schemaData.tables = schemaData.tables || [];

        document.getElementById('stats').textContent =
            `${schemaData.tables.length} tables`;

        if (schemaData.tables.length === 0) {
            document.getElementById('cy').innerHTML =
                '<div class="loading">No tables found in public schema</div>';
            return;
        }

        initGraph();
        setupSearch();
        setupZoomControls();
        setupKeyboardShortcuts();
    } catch (error) {
        document.getElementById('cy').innerHTML =
            `<div class="error">Error: ${error.message}</div>`;
    }
}

// ============================================================================
// Graph Visualization
// ============================================================================

function initGraph() {
    const elements = [];

    // Pre-calculate incoming relationships for each table
    const incomingRefs = {};
    schemaData.tables.forEach(table => {
        (table.foreignKeys || []).forEach(fk => {
            incomingRefs[fk.referencesTable] = (incomingRefs[fk.referencesTable] || 0) + 1;
        });
    });

    // Create nodes for each table
    schemaData.tables.forEach(table => {
        const outgoing = (table.foreignKeys || []).length;
        const incoming = incomingRefs[table.name] || 0;

        const columns = (table.columns || []).slice(0, 8).map(col => {
            const pk = col.isPrimary ? '🔑 ' : '   ';
            const fk = (table.foreignKeys || []).some(f => f.columnName === col.name) ? '🔗 ' : '   ';
            const prefix = col.isPrimary ? pk : fk;
            return `${prefix}${col.name}`;
        });

        // Add "..." if more columns
        if ((table.columns || []).length > 8) {
            columns.push(`   ... +${table.columns.length - 8} more`);
        }

        // Build header with relationship badges
        let header = table.name;
        const badges = [];
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
                outgoing: outgoing
            }
        });
    });

    // Create edges for foreign keys
    let relationshipCount = 0;
    schemaData.tables.forEach(table => {
        (table.foreignKeys || []).forEach(fk => {
            relationshipCount++;
            elements.push({
                data: {
                    id: `${table.name}-${fk.columnName}-${fk.referencesTable}`,
                    source: table.name,
                    target: fk.referencesTable,
                    sourceColumn: fk.columnName,
                    targetColumn: fk.referencesColumn,
                    label: `${table.name}.${fk.columnName} → ${fk.referencesTable}.${fk.referencesColumn}`
                }
            });
        });
    });

    // Show/hide no relationships notice
    document.getElementById('no-relationships').style.display =
        relationshipCount === 0 ? 'block' : 'none';

    document.getElementById('cy').innerHTML = '';

    cy = cytoscape({
        container: document.getElementById('cy'),
        elements: elements,
        minZoom: 0.2,
        maxZoom: 3,
        wheelSensitivity: 0.3,
        style: [
            {
                selector: 'node',
                style: {
                    'label': 'data(label)',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'background-color': '#0f3460',
                    'color': '#fff',
                    'font-size': '11px',
                    'font-family': 'Monaco, Consolas, monospace',
                    'width': 'label',
                    'height': 'label',
                    'padding': '16px',
                    'shape': 'round-rectangle',
                    'border-width': '2px',
                    'border-color': '#3498db',
                    'text-wrap': 'wrap',
                    'text-max-width': '200px'
                }
            },
            {
                selector: 'node:selected',
                style: {
                    'border-color': '#e94560',
                    'border-width': '3px'
                }
            },
            {
                selector: 'node.highlighted',
                style: {
                    'border-color': '#e94560',
                    'border-width': '3px',
                    'background-color': '#1a3a5c'
                }
            },
            {
                selector: 'node.dimmed',
                style: {
                    'opacity': 0.3
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': '#3498db',
                    'target-arrow-color': '#3498db',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'opacity': 0.7
                }
            },
            {
                selector: 'edge:selected',
                style: {
                    'line-color': '#e94560',
                    'target-arrow-color': '#e94560',
                    'opacity': 1,
                    'width': 3
                }
            },
            {
                selector: 'edge.highlighted',
                style: {
                    'line-color': '#e94560',
                    'target-arrow-color': '#e94560',
                    'opacity': 1,
                    'width': 3
                }
            },
            {
                selector: 'edge.dimmed',
                style: {
                    'opacity': 0.15
                }
            }
        ],
        layout: {
            name: 'dagre',
            rankDir: 'LR',
            nodeSep: 60,
            rankSep: 120,
            padding: 50
        }
    });

    // Update zoom level display
    cy.on('zoom', updateZoomLevel);
    updateZoomLevel();

    // Click on node to show details
    cy.on('tap', 'node', function(evt) {
        showTableDetails(evt.target.id());
        highlightConnections(evt.target.id());
    });

    // Hover effects
    cy.on('mouseover', 'node', function(evt) {
        document.body.style.cursor = 'pointer';
    });

    cy.on('mouseout', 'node', function(evt) {
        document.body.style.cursor = 'default';
    });

    // Show edge label on hover
    cy.on('mouseover', 'edge', function(evt) {
        document.body.style.cursor = 'pointer';
        evt.target.style('label', evt.target.data('label'));
        evt.target.style('text-background-color', '#0f3460');
        evt.target.style('text-background-opacity', 1);
        evt.target.style('text-background-padding', '6px');
        evt.target.style('text-background-shape', 'roundrectangle');
        evt.target.style('color', '#fff');
        evt.target.style('font-size', '11px');
        evt.target.style('font-family', 'Monaco, Consolas, monospace');
        evt.target.style('text-border-width', 1);
        evt.target.style('text-border-color', '#3498db');
        evt.target.style('text-border-opacity', 1);
        evt.target.style('width', 3);
        evt.target.style('line-color', '#e94560');
        evt.target.style('target-arrow-color', '#e94560');
    });

    cy.on('mouseout', 'edge', function(evt) {
        document.body.style.cursor = 'default';
        evt.target.style('label', '');
        evt.target.style('width', 2);
        evt.target.style('line-color', '#3498db');
        evt.target.style('target-arrow-color', '#3498db');
    });

    // Click on edge to show relationship details
    cy.on('tap', 'edge', function(evt) {
        const edge = evt.target;
        showRelationshipDetails(
            edge.data('source'),
            edge.data('sourceColumn'),
            edge.data('target'),
            edge.data('targetColumn')
        );
        highlightRelationship(edge);
    });
}

// ============================================================================
// Highlighting & Selection
// ============================================================================

function highlightRelationship(edge) {
    cy.elements().removeClass('highlighted dimmed').addClass('dimmed');
    edge.removeClass('dimmed').addClass('highlighted');
    edge.source().removeClass('dimmed').addClass('highlighted');
    edge.target().removeClass('dimmed').addClass('highlighted');
}

function highlightConnections(tableName) {
    // Reset all
    cy.elements().removeClass('highlighted dimmed');

    // Get the node and connected edges
    const node = cy.getElementById(tableName);
    const connectedEdges = node.connectedEdges();
    const connectedNodes = connectedEdges.connectedNodes();

    // Dim everything
    cy.elements().addClass('dimmed');

    // Highlight selected node and its connections
    node.removeClass('dimmed').addClass('highlighted');
    connectedEdges.removeClass('dimmed').addClass('highlighted');
    connectedNodes.removeClass('dimmed');
}

function clearHighlights() {
    cy.elements().removeClass('highlighted dimmed');
}

// ============================================================================
// Details Panel
// ============================================================================

function showRelationshipDetails(fromTable, fromColumn, toTable, toColumn) {
    selectedTable = null;
    const details = document.getElementById('details');

    details.innerHTML = `
        <div class="details-header">
            <h2>Relationship</h2>
            <button class="close-btn" onclick="closeDetails()">&times;</button>
        </div>
        <div class="relationship-details">
            <h3>Foreign Key</h3>
            <div class="relationship-card">
                <div class="from">
                    <span class="table-name">${fromTable}</span>.<span class="column-name">${fromColumn}</span>
                </div>
                <div class="arrow">&#8595;</div>
                <div class="to">
                    <span class="table-name">${toTable}</span>.<span class="column-name">${toColumn}</span>
                </div>
            </div>
        </div>
        <div class="details-content">
            <div class="section-title">Navigate</div>
            <ul class="column-list">
                <li class="column-item" onclick="navigateToTable('${fromTable}')" style="cursor:pointer">
                    <div class="column-name">${fromTable}</div>
                    <div class="column-type">Source table</div>
                </li>
                <li class="column-item" onclick="navigateToTable('${toTable}')" style="cursor:pointer">
                    <div class="column-name">${toTable}</div>
                    <div class="column-type">Referenced table</div>
                </li>
            </ul>
        </div>
    `;
}

function showTableDetails(tableName) {
    const table = schemaData.tables.find(t => t.name === tableName);
    if (!table) return;

    selectedTable = tableName;
    const details = document.getElementById('details');

    const fkColumns = new Set((table.foreignKeys || []).map(fk => fk.columnName));
    const fkDetails = {};
    (table.foreignKeys || []).forEach(fk => {
        fkDetails[fk.columnName] = fk;
    });

    let html = `
        <div class="details-header">
            <h2>${table.name}</h2>
            <button class="close-btn" onclick="closeDetails()">&times;</button>
        </div>
        <div class="details-content">
    `;

    html += `<div class="section-title">Columns (${(table.columns || []).length})</div>`;
    html += '<ul class="column-list">';

    (table.columns || []).forEach(col => {
        const isPrimary = col.isPrimary;
        const isFK = fkColumns.has(col.name);
        const classes = [isPrimary ? 'primary' : '', isFK ? 'fk' : ''].filter(Boolean).join(' ');

        html += `<li class="column-item ${classes}">`;
        html += `<div class="column-name">${col.name}</div>`;
        html += `<div class="column-type">${col.dataType}</div>`;
        html += '<div class="column-badges">';

        if (isPrimary) html += '<span class="badge pk">PK</span>';
        if (isFK) html += '<span class="badge fk">FK</span>';
        if (col.isNullable) html += '<span class="badge nullable">null</span>';

        html += '</div>';

        if (isFK) {
            const fk = fkDetails[col.name];
            html += `<div class="fk-ref" onclick="navigateToTable('${fk.referencesTable}')">→ ${fk.referencesTable}.${fk.referencesColumn}</div>`;
        }

        html += '</li>';
    });

    html += '</ul></div>';
    details.innerHTML = html;
}

function closeDetails() {
    selectedTable = null;
    clearHighlights();
    cy.elements().unselect();
    document.getElementById('details').innerHTML =
        '<div class="details-empty">Click a table to view details</div>';
}

function navigateToTable(tableName) {
    const node = cy.getElementById(tableName);
    if (node.length > 0) {
        // Center and zoom to the node
        cy.animate({
            center: { eles: node },
            zoom: 1.2
        }, { duration: 300 });

        // Select and show details
        cy.elements().unselect();
        node.select();
        showTableDetails(tableName);
        highlightConnections(tableName);
    }
}

// ============================================================================
// Search
// ============================================================================

function setupSearch() {
    const searchInput = document.getElementById('search');
    const searchContainer = document.getElementById('search-container');
    const clearBtn = document.getElementById('search-clear');

    function updateSearch() {
        const query = searchInput.value.toLowerCase().trim();

        // Toggle clear button visibility
        if (searchInput.value) {
            searchContainer.classList.add('has-value');
        } else {
            searchContainer.classList.remove('has-value');
        }

        // Find matching tables
        const matchingTables = schemaData.tables.filter(table => {
            if (table.name.toLowerCase().includes(query)) return true;
            return (table.columns || []).some(col =>
                col.name.toLowerCase().includes(query)
            );
        });

        // Update list view if active
        if (currentView === 'list') {
            renderListView();
        }

        if (!query) {
            clearHighlights();
            if (cy) cy.elements().removeClass('dimmed highlighted');
            document.getElementById('stats').textContent =
                `${schemaData.tables.length} tables`;
            return;
        }

        const matchingIds = new Set(matchingTables.map(t => t.name));

        // Highlight matches in graph view
        if (cy) {
            cy.nodes().forEach(node => {
                if (matchingIds.has(node.id())) {
                    node.removeClass('dimmed').addClass('highlighted');
                } else {
                    node.removeClass('highlighted').addClass('dimmed');
                }
            });
            cy.edges().addClass('dimmed');
        }

        // Update stats
        document.getElementById('stats').textContent =
            `${matchingTables.length} of ${schemaData.tables.length} tables`;
    }

    function clearSearch() {
        searchInput.value = '';
        searchContainer.classList.remove('has-value');
        clearHighlights();
        if (cy) cy.elements().removeClass('dimmed highlighted');
        document.getElementById('stats').textContent =
            `${schemaData.tables.length} tables`;
        if (currentView === 'list') {
            renderListView();
        }
    }

    searchInput.addEventListener('input', updateSearch);

    // Clear button click
    clearBtn.addEventListener('click', function() {
        clearSearch();
        searchInput.focus();
    });

    // Clear search on Escape
    searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            clearSearch();
            searchInput.blur();
        }
    });
}

// ============================================================================
// Zoom Controls
// ============================================================================

function setupZoomControls() {
    document.getElementById('zoom-in').addEventListener('click', () => {
        cy.animate({
            zoom: cy.zoom() * 1.3,
            center: { eles: cy.elements() }
        }, { duration: 200 });
    });

    document.getElementById('zoom-out').addEventListener('click', () => {
        cy.animate({
            zoom: cy.zoom() / 1.3,
            center: { eles: cy.elements() }
        }, { duration: 200 });
    });

    document.getElementById('zoom-fit').addEventListener('click', fitToView);
}

function fitToView() {
    cy.animate({
        fit: { eles: cy.elements(), padding: 50 }
    }, { duration: 300 });
}

function updateZoomLevel() {
    const zoom = Math.round(cy.zoom() * 100);
    document.getElementById('zoom-level').textContent = `${zoom}%`;
}

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        const searchInput = document.getElementById('search');
        const activeEl = document.activeElement;
        const isTyping = activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT';

        // Focus search on / (when not already typing)
        if (e.key === '/' && !isTyping) {
            e.preventDefault();
            e.stopPropagation();
            searchInput.focus();
            searchInput.select();
            return;
        }

        // Don't process other shortcuts while typing in any input
        if (isTyping) return;

        // Close details on Escape
        if (e.key === 'Escape' && selectedTable) {
            closeDetails();
        }

        // Refresh on R
        if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            refreshSchema();
        }

        // Zoom shortcuts
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
            fitToView();
        }
    });
}

// ============================================================================
// Create Table Modal
// ============================================================================

let currentModalTable = null;

function showCreateTableModal() {
    document.getElementById('new-table-name').value = '';
    document.getElementById('create-table-modal').classList.add('active');
    document.getElementById('new-table-name').focus();
}

function hideCreateTableModal() {
    document.getElementById('create-table-modal').classList.remove('active');
}

async function createTable() {
    const nameInput = document.getElementById('new-table-name');
    const name = nameInput.value.trim();

    if (!name) {
        nameInput.focus();
        return;
    }

    // Basic validation: lowercase, no spaces
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
        alert('Table name must be lowercase, start with a letter or underscore, and contain only letters, numbers, and underscores.');
        nameInput.focus();
        return;
    }

    // Confirmation dialog
    if (!confirm(`Create table "${name}" with primary key "id"?`)) {
        return;
    }

    const btn = document.getElementById('create-table-btn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
        const response = await fetch('/api/tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }

        hideCreateTableModal();
        await loadSchema();

        // Expand the new table in list view
        expandedTables.add(name);
        if (currentView === 'list') {
            renderListView();
        }
    } catch (error) {
        alert('Failed to create table: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Table';
    }
}

// ============================================================================
// Add Column Modal
// ============================================================================

function showAddColumnModal(tableName) {
    currentModalTable = tableName;
    document.getElementById('add-column-table-name').textContent = tableName;

    // Reset form
    document.getElementById('new-column-name').value = '';
    document.getElementById('new-column-type').value = 'text';
    document.getElementById('new-column-nullable').checked = false;
    document.getElementById('new-column-pk').checked = false;
    document.getElementById('new-column-unique').checked = false;
    document.getElementById('new-column-fk').checked = false;
    document.getElementById('fk-section').classList.add('disabled');

    // Populate FK table dropdown
    const fkTableSelect = document.getElementById('fk-table');
    fkTableSelect.innerHTML = '<option value="">Select table...</option>';
    if (schemaData && schemaData.tables) {
        schemaData.tables.forEach(table => {
            const option = document.createElement('option');
            option.value = table.name;
            option.textContent = table.name;
            fkTableSelect.appendChild(option);
        });
    }

    // Reset FK column dropdown
    document.getElementById('fk-column').innerHTML = '<option value="">Select column...</option>';

    document.getElementById('add-column-modal').classList.add('active');
    document.getElementById('new-column-name').focus();
}

function hideAddColumnModal() {
    document.getElementById('add-column-modal').classList.remove('active');
    currentModalTable = null;
}

function toggleForeignKeySection() {
    const isChecked = document.getElementById('new-column-fk').checked;
    const section = document.getElementById('fk-section');
    if (isChecked) {
        section.classList.remove('disabled');
    } else {
        section.classList.add('disabled');
    }
}

function loadForeignKeyColumns() {
    const tableName = document.getElementById('fk-table').value;
    const columnSelect = document.getElementById('fk-column');
    columnSelect.innerHTML = '<option value="">Select column...</option>';

    if (!tableName || !schemaData) return;

    const table = schemaData.tables.find(t => t.name === tableName);
    if (table && table.columns) {
        // Show columns with PK or UNIQUE constraints (valid FK targets)
        const refColumns = table.columns.filter(col => col.isPrimary || col.isUnique);
        refColumns.forEach((col, idx) => {
            const option = document.createElement('option');
            option.value = col.name;
            const badge = col.isPrimary ? 'PK' : 'UNIQUE';
            option.textContent = col.name + ' (' + col.dataType + ') [' + badge + ']';
            // Auto-select the first one (usually PK)
            if (idx === 0) option.selected = true;
            columnSelect.appendChild(option);
        });

        // If no referenceable columns found, show a message
        if (refColumns.length === 0) {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "No PK or UNIQUE columns";
            option.disabled = true;
            columnSelect.appendChild(option);
        }
    }
}

async function addColumn() {
    const name = document.getElementById('new-column-name').value.trim();
    const type = document.getElementById('new-column-type').value;
    const nullable = document.getElementById('new-column-nullable').checked;
    const primaryKey = document.getElementById('new-column-pk').checked;
    const unique = document.getElementById('new-column-unique').checked;
    const isForeignKey = document.getElementById('new-column-fk').checked;
    const fkTable = document.getElementById('fk-table').value;
    const fkColumn = document.getElementById('fk-column').value;

    if (!name) {
        document.getElementById('new-column-name').focus();
        return;
    }

    // Basic validation
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
        alert('Column name must be lowercase, start with a letter or underscore, and contain only letters, numbers, and underscores.');
        document.getElementById('new-column-name').focus();
        return;
    }

    if (isForeignKey && (!fkTable || !fkColumn)) {
        alert('Please select a table and column for the foreign key reference.');
        return;
    }

    // Build confirmation message
    let confirmMsg = `Add column "${name}" (${type}) to "${currentModalTable}"?`;
    const constraints = [];
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

    const btn = document.getElementById('add-column-btn');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    const payload = {
        name,
        type,
        nullable,
        primaryKey,
        unique
    };

    if (isForeignKey && fkTable && fkColumn) {
        payload.foreignKey = {
            referencesTable: fkTable,
            referencesColumn: fkColumn
        };
    }

    try {
        const response = await fetch(`/api/tables/${encodeURIComponent(currentModalTable)}/columns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }

        hideAddColumnModal();
        await loadSchema();

        // Keep the table expanded
        if (currentView === 'list') {
            renderListView();
        }
    } catch (error) {
        alert('Failed to add column: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Add Column';
    }
}

// ============================================================================
// Modal Event Handlers
// ============================================================================

document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        const createModal = document.getElementById('create-table-modal');
        const addModal = document.getElementById('add-column-modal');

        if (createModal.classList.contains('active')) {
            e.preventDefault();
            createTable();
        } else if (addModal.classList.contains('active')) {
            e.preventDefault();
            addColumn();
        }
    }

    // Close modals on Escape
    if (e.key === 'Escape') {
        hideCreateTableModal();
        hideAddColumnModal();
    }
});

// ============================================================================
// Initialize Application
// ============================================================================

loadDatabases();
loadSchema();
