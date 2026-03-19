const BASE = import.meta.env.VITE_BACKEND_URL || '';

export const apiFetch = (path, options) => fetch(`${BASE}${path}`, options);
