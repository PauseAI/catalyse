import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { ORPCError } from '@orpc/server'
import { MAX_UPLOAD_BYTES } from './profile-picture'

/** Side of the square thumbnail stored and served, in pixels: twice the largest avatar shown. */
export const PICTURE_SIZE = 256
/** Refuses an image that decodes to more pixels than this, however small its file. */
const MAX_INPUT_PIXELS = 40_000_000
/** Formats as sharp names them; `heif` covers AVIF. */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'heif'])

function refuse(message: string): never {
  throw new ORPCError('BAD_REQUEST', { message })
}

/**
 * An uploaded image, sent as a base64 `data:` URL, as the square WebP thumbnail that is stored:
 * cropped to its centre and turned upright from its EXIF orientation. Re-encoding drops the
 * original's metadata, location included, and means what is served is always an image whatever
 * the upload claimed to be.
 */
export async function toProfilePicture(dataUrl: string): Promise<Uint8Array<ArrayBuffer>> {
  const base64 = /^data:[^,]*;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)?.[1]
  if (base64 === undefined) refuse('Upload a JPEG, PNG, WebP, GIF or AVIF image')
  const input = Buffer.from(base64, 'base64')
  if (input.length > MAX_UPLOAD_BYTES) {
    refuse(`Pictures must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller`)
  }
  const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
  const metadata = await image.metadata().catch(() => null)
  if (!metadata?.format || !ACCEPTED_FORMATS.has(metadata.format)) {
    refuse('Upload a JPEG, PNG, WebP, GIF or AVIF image')
  }
  return image
    .rotate()
    .resize(PICTURE_SIZE, PICTURE_SIZE, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer()
    .then((output) => new Uint8Array(output))
    .catch(() => refuse('That image could not be read'))
}

/** A new random id for a picture's URL. */
export function newPublicId(): string {
  return randomBytes(16).toString('base64url')
}
