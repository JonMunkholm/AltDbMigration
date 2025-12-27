// API Client - Centralized API communication layer

import type {
  ApiResponse,
  Schema,
  DatabasesData,
  SwitchDatabaseData,
  CreateTableData,
  AddColumnData,
  AddColumnRequest,
  TypesData,
} from './types';

// Custom error class with code property
export class ApiError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'ApiError';
  }
}

// CSRF token - fetched on init and refreshed on rotation
let csrfToken: string | null = null;

// Fetch CSRF token from server
async function fetchCSRFToken(): Promise<string> {
  const response = await fetch('/api/csrf-token');
  if (!response.ok) {
    throw new ApiError('Failed to fetch CSRF token', 'CSRF_ERROR');
  }
  const data = await response.json();
  if (!data.success || !data.data?.token) {
    throw new ApiError('Invalid CSRF token response', 'CSRF_ERROR');
  }
  return data.data.token;
}

// Refresh the CSRF token
async function refreshCSRFToken(): Promise<void> {
  csrfToken = await fetchCSRFToken();
}

// Get headers for state-changing requests
function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken || '',
  };
}

// Fetch with automatic CSRF token refresh on 403
async function fetchWithCSRFRetry(
  url: string,
  options: RequestInit
): Promise<Response> {
  let response = await fetch(url, options);

  // If we get a CSRF error, refresh token and retry once
  if (response.status === 403) {
    try {
      const data = await response.clone().json();
      if (data.error?.code === 'CSRF_ERROR') {
        await refreshCSRFToken();
        // Retry with new token
        const newOptions = {
          ...options,
          headers: {
            ...options.headers,
            'X-CSRF-Token': csrfToken || '',
          },
        };
        response = await fetch(url, newOptions);
      }
    } catch {
      // If we can't parse the response, just return it
    }
  }

  return response;
}

export const Api = {
  // Initialize API (fetch CSRF token)
  async init(): Promise<void> {
    csrfToken = await fetchCSRFToken();
  },

  // Parse API response and handle errors consistently
  async handleResponse<T>(response: Response): Promise<T> {
    // Check HTTP status first
    if (!response.ok) {
      // Try to parse error from JSON body
      try {
        const data: ApiResponse<T> = await response.json();
        throw new ApiError(
          data.error?.message || `HTTP ${response.status}: ${response.statusText}`,
          data.error?.code || 'HTTP_ERROR'
        );
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(
          `HTTP ${response.status}: ${response.statusText}`,
          'HTTP_ERROR'
        );
      }
    }

    const data: ApiResponse<T> = await response.json();

    if (!data.success) {
      throw new ApiError(
        data.error?.message || 'Unknown error',
        data.error?.code || 'UNKNOWN_ERROR'
      );
    }

    return data.data as T;
  },

  async getDatabases(): Promise<DatabasesData> {
    const response = await fetch('/api/databases');
    return this.handleResponse<DatabasesData>(response);
  },

  async switchDatabase(name: string): Promise<SwitchDatabaseData> {
    const response = await fetchWithCSRFRetry('/api/database', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    return this.handleResponse<SwitchDatabaseData>(response);
  },

  async getSchema(): Promise<Schema> {
    const response = await fetch('/api/schema');
    return this.handleResponse<Schema>(response);
  },

  async getTypes(): Promise<TypesData> {
    const response = await fetch('/api/types');
    return this.handleResponse<TypesData>(response);
  },

  async createTable(name: string): Promise<CreateTableData> {
    const response = await fetchWithCSRFRetry('/api/tables', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    return this.handleResponse<CreateTableData>(response);
  },

  async addColumn(tableName: string, columnData: AddColumnRequest): Promise<AddColumnData> {
    const response = await fetchWithCSRFRetry(
      `/api/tables/${encodeURIComponent(tableName)}/columns`,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(columnData),
      }
    );
    return this.handleResponse<AddColumnData>(response);
  },
};
