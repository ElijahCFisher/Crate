export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
export const API_BASE = import.meta.env.VITE_API_BASE;

export const DRIVE_FOLDER_NAME = 'Food Ratings';
export const DRIVE_FILE_NAME = 'food-ratings-data.csv';

// Full scope string used by the auth-code login flow (includes openid + drive)
export const GOOGLE_AUTH_SCOPE =
  'openid email profile https://www.googleapis.com/auth/drive.file';
