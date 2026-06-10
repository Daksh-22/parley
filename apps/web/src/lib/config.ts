// The API origin. In dev, Vite serves the app on :5173 and the server runs
// on :4000. In production builds this comes from VITE_API_URL.
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
