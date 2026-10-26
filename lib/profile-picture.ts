/** The largest file a volunteer may upload; it is shrunk to a thumbnail before it is stored. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
/** What the file picker offers; the server decides by decoding the file, not by its type. */
export const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,image/gif,image/avif'

export const PICTURE_CONTENT_TYPE = 'image/webp'

/** Longest `data:` URL an upload of MAX_UPLOAD_BYTES encodes to, its prefix included. */
export const MAX_DATA_URL_LENGTH = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 100

export function profilePictureUrl(publicId: string): string {
  return `/api/profile-pictures/${publicId}`
}
