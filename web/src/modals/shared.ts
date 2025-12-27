// Shared utilities for modals

import { Api } from '../api';
import type { TypeInfo } from '../types';

// Cached types from backend
let cachedTypes: TypeInfo[] | null = null;

// Fetch and cache types from backend
export async function ensureTypesLoaded(): Promise<TypeInfo[]> {
  if (cachedTypes) return cachedTypes;
  try {
    const data = await Api.getTypes();
    cachedTypes = data.types;
    return cachedTypes;
  } catch (error) {
    console.error('Failed to load types:', error);
    return [];
  }
}

// Populate type dropdown from cached types
export function populateTypeDropdown(select: HTMLSelectElement, types: TypeInfo[]): void {
  select.innerHTML = '';

  // Group types by category
  const byCategory = new Map<string, TypeInfo[]>();
  for (const t of types) {
    const list = byCategory.get(t.category) || [];
    list.push(t);
    byCategory.set(t.category, list);
  }

  // Create optgroups for each category
  for (const [category, categoryTypes] of byCategory) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = category;
    for (const t of categoryTypes) {
      const option = document.createElement('option');
      option.value = t.name;
      option.textContent = `${t.name} - ${t.description}`;
      optgroup.appendChild(option);
    }
    select.appendChild(optgroup);
  }
}

// Type-safe element getter - returns null if element not found or wrong type
export function getElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
