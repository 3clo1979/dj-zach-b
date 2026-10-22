// One small original image, deliberately below D1's 2,000,000-byte row/BLOB limit.
export const STUDIO_PHOTO_MAX_BYTES = 1_000_000;
export const STUDIO_PHOTO_TYPES = ['image/jpeg', 'image/png'] as const;
export type StudioPhotoType = typeof STUDIO_PHOTO_TYPES[number];
