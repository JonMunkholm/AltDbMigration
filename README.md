# PostgreSQL Schema Visualizer

A web-based tool for visualizing and managing PostgreSQL database schemas. Built with Go and TypeScript.

## Features

- **Graph View** - Interactive schema visualization with Cytoscape.js
- **List View** - Expandable table accordions with column details
- **Create Tables** - Add new tables with automatic primary key
- **Add Columns** - Add columns with foreign key constraints
- **Multi-Database** - Switch between databases on the same server
- **Search** - Filter tables by name
- **Layouts** - Dagre (hierarchical) and CoSE-Bilkent (force-directed)

## Prerequisites

- Go 1.21+
- PostgreSQL
- Node.js 18+

## Quick Start

```bash
# Clone
git clone https://github.com/JonMunkholm/AltDbMigration.git
cd AltDbMigration

# Configure
echo "DATABASE_URL=postgres://user:password@localhost/dbname" > .env

# Build frontend
cd web && npm install && npm run build && cd ..

# Run
go run .
```

Open http://localhost:8080 in your browser.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| DATABASE_URL | Yes | - | PostgreSQL connection URL |
| PORT | No | 8080 | HTTP server port |
| READ_TIMEOUT | No | 10 | Request read timeout (seconds) |
| WRITE_TIMEOUT | No | 10 | Response write timeout (seconds) |
| SHUTDOWN_TIMEOUT | No | 5 | Graceful shutdown timeout (seconds) |
| QUERY_TIMEOUT | No | 30 | Database query timeout (seconds) |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `r` | Refresh schema |
| `+` / `-` | Zoom in/out |
| `0` | Fit to view |
| `Escape` | Close details panel |

## Project Structure

```
├── main.go                 # Entry point
├── internal/
│   ├── api/               # HTTP handlers, middleware
│   ├── config/            # Configuration loading
│   └── schema/            # PostgreSQL introspection & mutations
└── web/
    ├── src/               # TypeScript source
    │   ├── app.ts         # Main application
    │   ├── graph.ts       # Cytoscape graph
    │   ├── list.ts        # List view
    │   ├── modals/        # Create table/add column modals
    │   └── ...
    ├── dist/              # Built bundle
    ├── index.html
    └── styles.css
```

## Development

```bash
cd web
npm run build:dev   # Development build with sourcemaps
npm run watch       # Watch mode for auto-rebuild
npm run typecheck   # TypeScript type checking
```

## License

MIT
